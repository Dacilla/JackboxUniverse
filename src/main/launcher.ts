import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BrowserWindow } from "electron";
import type { GameInstallation, LaunchResult } from "../shared/types.js";
import { getLaunchArguments } from "./scanner.js";

let activeProcess: ChildProcessWithoutNullStreams | undefined;
let activeWindow: BrowserWindow | undefined;

export function launchInstallation(window: BrowserWindow, installation: GameInstallation): LaunchResult {
  if (activeProcess?.pid) {
    return {
      ok: false,
      pid: activeProcess.pid,
      message: "A Jackbox game is already running."
    };
  }

  const args = getLaunchArguments(installation);
  const mode = args.length > 0 ? "direct" : "pack-menu";
  const child = spawn(installation.executablePath, args, {
    cwd: installation.packPath,
    windowsHide: false,
    stdio: "pipe"
  });

  activeProcess = child;
  activeWindow = window;

  child.once("spawn", () => {
    window.minimize();
  });

  child.once("exit", () => {
    activeProcess = undefined;
    if (activeWindow && !activeWindow.isDestroyed()) {
      activeWindow.show();
      activeWindow.focus();
    }
  });

  child.once("error", () => {
    activeProcess = undefined;
    if (activeWindow && !activeWindow.isDestroyed()) {
      activeWindow.show();
      activeWindow.focus();
    }
  });

  return {
    ok: true,
    pid: child.pid,
    mode,
    message: mode === "direct" ? "Launching game." : "Launching pack menu."
  };
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
