import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import type { BrowserWindow } from "electron";
import type { GameInstallation, LaunchResult } from "../shared/types.js";
import { getLaunchArguments } from "./scanner.js";

let activeProcess: ChildProcess | undefined;
let activeWindow: BrowserWindow | undefined;

export async function launchInstallation(window: BrowserWindow, installation: GameInstallation): Promise<LaunchResult> {
  if (activeProcess?.pid) {
    return {
      ok: false,
      pid: activeProcess.pid,
      message: "A Jackbox game is already running."
    };
  }

  try {
    await fs.access(installation.executablePath);
  } catch {
    return {
      ok: false,
      message: `The pack executable was not found at ${installation.executablePath}.`
    };
  }

  const args = getLaunchArguments(installation);
  const mode = args.length > 0 ? "direct" : "pack-menu";

  if (mode === "direct") {
    // Try with isBundle=false first (works for packs 3-11, Naughty)
    const result = await trySpawn(window, installation.executablePath, installation.packPath, args);
    if (result.ok) return result;

    // Fallback: try without isBundle=false (some packs reject -jbg.config)
    const argsNoBundle = args.filter((a) => a !== "-jbg.config" && a !== "isBundle=false");
    const result2 = await trySpawn(window, installation.executablePath, installation.packPath, argsNoBundle);
    if (result2.ok) return result2;
  }

  // Final fallback: launch the pack menu (no arguments)
  return trySpawn(window, installation.executablePath, installation.packPath, []);
}

function trySpawn(
  window: BrowserWindow,
  executablePath: string,
  packPath: string,
  args: string[]
): Promise<LaunchResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(executablePath, args, {
        cwd: packPath,
        windowsHide: false,
        stdio: "ignore"
      });
    } catch (error) {
      resolve({
        ok: false,
        message: `Failed to start the game: ${error instanceof Error ? error.message : String(error)}.`
      });
      return;
    }

    let settled = false;
    const mode = args.length > 0 ? "direct" : "pack-menu";

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        message: `Failed to start the game: ${error.message}.`
      });
    });

    child.once("spawn", () => {
      activeProcess = child;
      activeWindow = window;
      window.minimize();

      // Detect quick exit — if the process dies within 1500ms, the args were wrong
      child.once("exit", (code) => {
        if (settled) return;
        settled = true;
        activeProcess = undefined;
        if (activeWindow && !activeWindow.isDestroyed()) {
          activeWindow.show();
          activeWindow.focus();
        }
        resolve({
          ok: false,
          pid: child.pid,
          mode,
          message: "The game exited immediately after starting."
        });
      });

      // If the process is still alive after 1500ms, it's a successful launch
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: true,
          pid: child.pid,
          mode,
          message: mode === "direct" ? "Launching game." : "Launching pack menu."
        });
      }, 1500);
    });

    // Normal exit cleanup — when the user closes the game
    child.once("exit", () => {
      activeProcess = undefined;
      if (activeWindow && !activeWindow.isDestroyed()) {
        activeWindow.show();
        activeWindow.focus();
      }
    });
  });
}

export function killActiveGame(): Promise<LaunchResult> {
  if (!activeProcess?.pid) {
    return Promise.resolve({ ok: false, message: "No active Jackbox process is being tracked." });
  }

  const pid = activeProcess.pid;
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });

    killer.once("exit", (code) => {
      activeProcess = undefined;
      if (activeWindow && !activeWindow.isDestroyed()) {
        activeWindow.show();
        activeWindow.focus();
      }
      resolve({
        ok: code === 0,
        pid,
        message: code === 0 ? "Active game closed." : "Unable to close the active game."
      });
    });

    killer.once("error", () => {
      activeProcess?.kill();
      activeProcess = undefined;
      resolve({ ok: false, pid, message: "Unable to run taskkill; attempted a normal process kill." });
    });
  });
}
