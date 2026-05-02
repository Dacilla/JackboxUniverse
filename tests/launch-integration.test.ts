/**
 * Integration tests for the game launching pipeline.
 * Uses locally installed Jackbox packs discovered via electron-store.
 * Skips automatically if no packs are configured on this machine.
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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

let testPackPaths: string[] = [];

beforeAll(async () => {
  const stored = readStorePackPaths();
  testPackPaths = await validatePackPaths(stored);
});

const hasPacks = () => testPackPaths.length > 0;

describe("launch pipeline (real installs)", () => {
  it("builds a library from installed packs with valid game installations", async () => {
    if (testPackPaths.length === 0) return;

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
    if (testPackPaths.length === 0) return;

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
    if (testPackPaths.length === 0) return;

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

    await killActiveGame();
    await new Promise((r) => setTimeout(r, 1500));
  }, 30000);

  it("kills a launched game and verifies the process exits", async () => {
    if (testPackPaths.length === 0) return;

    const library = await buildLibrary(testPackPaths, {}, {}, undefined);
    const game = library.games.find((g) => g.selected.directLaunchSupported);
    expect(game).toBeTruthy();
    if (!game) return;

    const window = createMockWindow();
    const launchResult = await launchInstallation(window, game.selected);
    expect(launchResult.ok).toBe(true);
    const pid = launchResult.pid!;

    expect(execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8", windowsHide: true })).toContain(String(pid));

    const killResult = await killActiveGame();
    expect(killResult.ok).toBe(true);
    expect(killResult.pid).toBe(pid);

    await new Promise((r) => setTimeout(r, 2000));
    expect(execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8", windowsHide: true })).toContain("No tasks");

    expect(window.calls).toContain("show");
    expect(window.calls).toContain("minimize");
  }, 30000);

  it("launch-kill-relaunch cycle produces a new PID", async () => {
    if (testPackPaths.length === 0) return;

    const library = await buildLibrary(testPackPaths, {}, {}, undefined);
    const game = library.games.find((g) => g.selected.directLaunchSupported);
    expect(game).toBeTruthy();
    if (!game) return;

    const r1 = await launchInstallation(createMockWindow(), game.selected);
    expect(r1.ok).toBe(true);
    await killActiveGame();
    await new Promise((r) => setTimeout(r, 2000));

    const r2 = await launchInstallation(createMockWindow(), game.selected);
    expect(r2.ok).toBe(true);
    expect(r2.pid).not.toBe(r1.pid);

    await killActiveGame();
    await new Promise((r) => setTimeout(r, 1000));
  }, 30000);
});
