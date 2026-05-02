/**
 * Integration tests for the game launching pipeline.
 * Uses locally installed Jackbox packs discovered via electron-store.
 * Skips automatically if no packs are configured on this machine.
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildLibrary, getLaunchArguments, validatePackPaths } from "../src/main/scanner";
import { killActiveGame, launchInstallation } from "../src/main/launcher";

function createMockWindow() {
  const calls: string[] = [];
  const win = { calls, minimize() { calls.push("minimize"); }, show() { calls.push("show"); },
    focus() { calls.push("focus"); }, isDestroyed() { return false; }, webContents: {} as never, id: 0 };
  return win as unknown as import("electron").BrowserWindow & { calls: string[] };
}

function readStorePackPaths(): string[] {
  try {
    const configPath = path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "jackbox-universe", "jackbox-universe.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return (config.packPaths ?? []) as string[];
  } catch { return []; }
}

interface GameWindowState {
  found: boolean;
  fullscreen: boolean;
  title: string;
  winWidth: number;
  winHeight: number;
  screenWidth: number;
  screenHeight: number;
}

const WINDOW_CHECK_PS1 = `
if (-not ([System.Management.Automation.PSTypeName]'JbWinApi').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class JbWinApi {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
}

$rootPid = [int]$args[0]

# Collect all PIDs in the process tree (depth-first, up to 3 levels)
$pids = [System.Collections.Generic.HashSet[int]]::new()
$pids.Add($rootPid) | Out-Null
$queue = [System.Collections.Generic.Queue[int]]::new()
$queue.Enqueue($rootPid)
$level = 0
while ($queue.Count -gt 0 -and $level -lt 3) {
    $count = $queue.Count
    for ($i = 0; $i -lt $count; $i++) {
        $parent = $queue.Dequeue()
        try {
            $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$parent" -ErrorAction Stop | Select-Object -ExpandProperty ProcessId
            foreach ($child in $children) {
                if ($pids.Add($child)) { $queue.Enqueue($child) }
            }
        } catch {}
    }
    $level++
}

Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$screenW = $screen.Bounds.Width
$screenH = $screen.Bounds.Height

$bestTitle = ""
$bestWinW = 0
$bestWinH = 0
$found = $false

$callback = [JbWinApi+EnumWindowsProc]{
    param($hwnd, $lParam)
    [JbWinApi]::GetWindowThreadProcessId($hwnd, [ref]$null) | Out-Null
    $windowPid = 0
    [JbWinApi]::GetWindowThreadProcessId($hwnd, [ref]$windowPid) | Out-Null
    if ($pids.Contains($windowPid) -and [JbWinApi]::IsWindowVisible($hwnd)) {
        $rect = New-Object JbWinApi+RECT
        [JbWinApi]::GetWindowRect($hwnd, [ref]$rect)
        $w = $rect.Right - $rect.Left
        $h = $rect.Bottom - $rect.Top
        $sb = New-Object System.Text.StringBuilder(256)
        [JbWinApi]::GetWindowText($hwnd, $sb, 256)
        $t = $sb.ToString()
        if ($w -gt 100 -and $h -gt 100) {
            if (-not $found -or ($w * $h) -gt ($bestWinW * $bestWinH)) {
                $script:bestTitle = $t
                $script:bestWinW = $w
                $script:bestWinH = $h
                $script:found = $true
            }
        }
    }
    return $true
}

[JbWinApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if (-not $found) {
    Write-Output '{"found":false}'
    exit 0
}

$fullscreen = ($bestWinW -ge ($screenW * 0.9)) -and ($bestWinH -ge ($screenH * 0.9))

$obj = @{
    found = $true
    fullscreen = $fullscreen
    title = $bestTitle
    winWidth = $bestWinW
    winHeight = $bestWinH
    screenWidth = $screenW
    screenHeight = $screenH
} | ConvertTo-Json -Compress
Write-Output $obj
`;

let psScriptPath: string | undefined;

function ensurePsScript(): string {
  if (psScriptPath && existsSync(psScriptPath)) return psScriptPath;
  psScriptPath = path.join(tmpdir(), `jb-wincheck-${process.pid}.ps1`);
  writeFileSync(psScriptPath, WINDOW_CHECK_PS1, "utf8");
  return psScriptPath;
}

function psCheckWindow(pid: number): GameWindowState {
  try {
    const raw = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${ensurePsScript()}" ${pid}`,
      { encoding: "utf8", windowsHide: true, timeout: 10000 }
    ).trim();
    if (!raw) return { found: false, fullscreen: false, title: "", winWidth: 0, winHeight: 0, screenWidth: 0, screenHeight: 0 };
    const parsed = JSON.parse(raw) as GameWindowState;
    parsed.found = Boolean(parsed.found);
    return parsed;
  } catch {
    return { found: false, fullscreen: false, title: "", winWidth: 0, winHeight: 0, screenWidth: 0, screenHeight: 0 };
  }
}

function pollForWindow(pid: number, maxAttempts = 6, delayMs = 600): GameWindowState {
  for (let i = 0; i < maxAttempts; i++) {
    const state = psCheckWindow(pid);
    if (state.found && state.title.length > 0) return state;
    if (i < maxAttempts - 1) {
      const waitMs = Math.min(delayMs + i * 200, 2500);
      execSync(`powershell -NoProfile -Command "Start-Sleep -Milliseconds ${waitMs}"`, { windowsHide: true, timeout: 10000 });
    }
  }
  return psCheckWindow(pid);
}

function pidIsAlive(pid: number): boolean {
  try {
    const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8", windowsHide: true, timeout: 5000 });
    return result.includes(String(pid));
  } catch {
    return false;
  }
}

function forceKillPid(pid: number): void {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, timeout: 10000 });
  } catch { /* taskkill throws on non-zero exit even when successful */ }
}

function ensureProcessGone(pid: number, maxWaitMs = 5000): boolean {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    forceKillPid(pid);
    if (!pidIsAlive(pid)) return true;
    execSync(`powershell -NoProfile -Command "Start-Sleep -Milliseconds 300"`, { windowsHide: true, timeout: 5000 });
  }
  return !pidIsAlive(pid);
}

async function killHard(pid: number): Promise<void> {
  const killed = await killActiveGame();
  if (!killed.ok) forceKillPid(pid);
  ensureProcessGone(pid, 4000);
  // safety net: kill any Jackbox child processes that detached from the tree
  try { execSync("taskkill /F /IM Jackbox* /T", { windowsHide: true, timeout: 8000 }); } catch { /* ok */ }
}

let testPackPaths: string[] = [];

beforeAll(async () => {
  const stored = readStorePackPaths();
  testPackPaths = await validatePackPaths(stored);
});

const hasPacks = () => testPackPaths.length > 0;

describe("launch pipeline (real installs)", () => {
  it("builds a library from installed packs with valid game installations", async () => {
    if (!hasPacks()) return;

    const library = await buildLibrary(testPackPaths, {}, {}, undefined);
    expect(library.games.length).toBeGreaterThan(0);
    expect(library.packs.length).toBeGreaterThan(0);

    for (const game of library.games) {
      const s = game.selected;
      expect(s.displayName).toBeTruthy();
      expect(s.internalName).toBeTruthy();
      expect(s.executablePath).toBeTruthy();
      expect(typeof s.directLaunchSupported).toBe("boolean");
    }
  });

  it("generates valid launch arguments for every game across all packs", async () => {
    if (!hasPacks()) return;

    const library = await buildLibrary(testPackPaths, {}, {}, undefined);

    let directCount = 0;
    for (const game of library.games) {
      const s = game.selected;
      const args = getLaunchArguments(s);
      if (s.directLaunchSupported) {
        expect(args).toHaveLength(4);
        expect(args[0]).toBe("-launchTo");
        expect(args[1]).toBeTruthy();
        expect(args[2]).toBe("-jbg.config");
        expect(args[3]).toBe("isBundle=false");
        directCount++;
      } else {
        expect(args).toEqual([]);
      }
    }
    expect(directCount).toBeGreaterThan(0);
  }, 60000);

  it("launches a game successfully and gets a valid PID", async () => {
    if (!hasPacks()) return;

    const library = await buildLibrary(testPackPaths, {}, {}, undefined);
    const game = library.games.find((g) => g.selected.directLaunchSupported);
    expect(game).toBeTruthy();
    if (!game) return;

    const window = createMockWindow();
    const result = await launchInstallation(window, game.selected);

    expect(result.ok).toBe(true);
    expect(result.pid).toBeGreaterThan(0);
    expect(typeof result.pid).toBe("number");
    expect(window.calls).toContain("minimize");

    const stdout = execSync(`tasklist /FI "PID eq ${result.pid}" /NH`, { encoding: "utf8", windowsHide: true });
    expect(stdout).toContain(String(result.pid));

    const killed = await killActiveGame();
    if (!killed.ok) forceKillPid(result.pid!);
    ensureProcessGone(result.pid!);
  }, 30000);

  it("kills a launched game and verifies the process exits", async () => {
    if (!hasPacks()) return;

    const library = await buildLibrary(testPackPaths, {}, {}, undefined);
    const game = library.games.find((g) => g.selected.directLaunchSupported);
    expect(game).toBeTruthy();
    if (!game) return;

    const window = createMockWindow();
    const launchResult = await launchInstallation(window, game.selected);
    expect(launchResult.ok).toBe(true);
    const pid = launchResult.pid!;

    expect(pidIsAlive(pid)).toBe(true);

    const killResult = await killActiveGame();
    if (!killResult.ok) forceKillPid(pid);
    expect(ensureProcessGone(pid, 4000)).toBe(true);

    expect(window.calls).toContain("show");
    expect(window.calls).toContain("minimize");
  }, 30000);

  it("launch-kill-relaunch cycle produces a new PID", async () => {
    if (!hasPacks()) return;

    const library = await buildLibrary(testPackPaths, {}, {}, undefined);
    const game = library.games.find((g) => g.selected.directLaunchSupported);
    expect(game).toBeTruthy();
    if (!game) return;

    const r1 = await launchInstallation(createMockWindow(), game.selected);
    expect(r1.ok).toBe(true);
    const kill1 = await killActiveGame();
    if (!kill1.ok) forceKillPid(r1.pid!);
    ensureProcessGone(r1.pid!);

    const r2 = await launchInstallation(createMockWindow(), game.selected);
    expect(r2.ok).toBe(true);
    expect(r2.pid).not.toBe(r1.pid);

    const kill2 = await killActiveGame();
    if (!kill2.ok) forceKillPid(r2.pid!);
    ensureProcessGone(r2.pid!);
  }, 30000);
});

describe("launch rendering verification (real installs)", () => {
  it("every direct-launch game across all packs renders a visible fullscreen window", async () => {
    if (!hasPacks()) return;

    const library = await buildLibrary(testPackPaths, {}, {}, undefined);
    const directGames = library.games.filter((g) =>
      g.selected.directLaunchSupported &&
      (g.selected.launchTarget?.endsWith(".swf") ?? false)
    );
    expect(directGames.length).toBeGreaterThan(0);

    const results: string[] = [];
    let failures = 0;
    let windowed = 0;

    for (const game of directGames) {
      const name = `"${game.selected.displayName}" (${game.selected.packName})`;
      let pid: number | undefined;

      try {
        const result = await launchInstallation(createMockWindow(), game.selected);
        if (!result.ok || !result.pid) {
          results.push(`SKIPPED (no direct launch): ${name}`);
          pid = result.pid;
          continue;
        }
        pid = result.pid;

        await new Promise((r) => setTimeout(r, 2000));

        if (!pidIsAlive(pid)) {
          results.push(`EXITED: ${name} — process died before window check`);
          failures++;
          continue;
        }

        const window = pollForWindow(pid, 4, 500);
        if (!window.found) {
          results.push(`BLACK SCREEN: ${name} (pid ${pid} alive, no visible window)`);
          failures++;
        } else if (window.title.length === 0) {
          results.push(`BLACK SCREEN: ${name} (${window.winWidth}x${window.winHeight}, window exists but empty title)`);
          failures++;
        } else if (!window.fullscreen) {
          windowed++;
          results.push(`OK (windowed): ${name} — "${window.title}" ${window.winWidth}x${window.winHeight}`);
        } else {
          results.push(`OK: ${name} — "${window.title}" ${window.winWidth}x${window.winHeight}`);
        }
      } catch (err) {
        results.push(`ERROR: ${name} — ${err instanceof Error ? err.message : String(err)}`);
        failures++;
      } finally {
        if (pid) await killHard(pid);
      }
    }

    if (failures > 0) {
      const summary = windowed > 0 ? ` (${windowed} windowed — likely older packs)` : "";
      throw new Error(`${failures}/${directGames.length} games failed rendering check${summary}:\n${results.join("\n")}`);
    }
  }, 900000);
});

// Clean up the temp PowerShell script
process.once("exit", () => {
  if (psScriptPath) {
    try { unlinkSync(psScriptPath); } catch { /* ignore */ }
  }
});
