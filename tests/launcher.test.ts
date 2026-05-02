import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { killActiveGame, launchInstallation } from "../src/main/launcher";
import { getLaunchArguments } from "../src/main/scanner";
import type { GameInstallation } from "../src/shared/types";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  fixtureRoots.length = 0;
});

function createFixtureInstallation(overrides: Partial<GameInstallation> = {}): GameInstallation {
  return {
    installationId: "install-test",
    gameId: "test::test",
    duplicateKey: "test::test",
    packId: "pack-test",
    packName: "Test Pack",
    packPath: "C:\\Games\\TestPack",
    executablePath: "C:\\Games\\TestPack\\Jackbox.exe",
    gamesPath: "C:\\Games\\TestPack\\games",
    internalName: "TestGame",
    folderPath: "C:\\Games\\TestPack\\games\\TestGame",
    displayName: "Test Game",
    description: "",
    directLaunchSupported: true,
    launchTarget: "games/TestGame/TestGame.swf",
    launchLabel: "Launch Game",
    ...overrides
  };
}

function createMockWindow() {
  return {
    minimize: () => {},
    show: () => {},
    focus: () => {},
    isDestroyed: () => false
  } as unknown as import("electron").BrowserWindow;
}

describe("getLaunchArguments", () => {
  it("returns direct launch args for a supported game", () => {
    const installation = createFixtureInstallation();
    const args = getLaunchArguments(installation);

    expect(args).toEqual([
      "-launchTo",
      "games/TestGame/TestGame.swf",
      "-jbg.config",
      "isBundle=false"
    ]);
  });

  it("returns empty array when direct launch is not supported", () => {
    const installation = createFixtureInstallation({
      directLaunchSupported: false,
      launchTarget: undefined
    });
    expect(getLaunchArguments(installation)).toEqual([]);
  });

  it("replaces backslashes with forward slashes", () => {
    const installation = createFixtureInstallation({
      launchTarget: "games\\TestGame\\TestGame.swf"
    });
    expect(getLaunchArguments(installation)[1]).toBe("games/TestGame/TestGame.swf");
  });

  it("falls back to standard SWF path when launchTarget is unset", () => {
    const installation = createFixtureInstallation({
      launchTarget: undefined,
      internalName: "TriviaDeath"
    });
    expect(getLaunchArguments(installation)[1]).toBe("games/TriviaDeath/TriviaDeath.swf");
  });

  it("handles game names with spaces and special characters in the path", () => {
    const installation = createFixtureInstallation({
      internalName: "Mad Verse City",
      launchTarget: "games/Mad Verse City/Mad Verse City.swf"
    });
    const args = getLaunchArguments(installation);
    expect(args[1]).toContain("Mad Verse City");
    expect(args[1]).toContain("games/");
  });

  it("always includes isBundle=false config", () => {
    const args = getLaunchArguments(createFixtureInstallation());
    expect(args[2]).toBe("-jbg.config");
    expect(args[3]).toBe("isBundle=false");
  });
});

describe("launchInstallation", () => {
  it("rejects when the pack executable does not exist on disk", async () => {
    const window = createMockWindow();
    const installation = createFixtureInstallation({
      executablePath: "C:\\nonexistent\\path\\Jackbox.exe"
    });

    const result = await launchInstallation(window, installation);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("rejects when the executable path points to a directory", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `launch-dir-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });

    const window = createMockWindow();
    const installation = createFixtureInstallation({
      executablePath: root
    });

    const result = await launchInstallation(window, installation);

    expect(result.ok).toBe(false);
  });

  it("rejects spawn of a non-executable file on Windows", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `launch-txt-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });
    const txtPath = path.join(root, "NotAnExe.txt");
    await writeFile(txtPath, "hello world");

    const window = createMockWindow();
    const installation = createFixtureInstallation({
      executablePath: txtPath,
      packPath: root
    });

    const result = await launchInstallation(window, installation);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed to start");
    expect(result.message).toContain("EFTYPE");
  });

  it("produces pack-menu mode when direct launch is not supported", () => {
    const installation = createFixtureInstallation({
      directLaunchSupported: false,
      launchTarget: undefined,
      launchLabel: "Launch Pack Menu"
    });

    const args = getLaunchArguments(installation);
    expect(args).toEqual([]);
  });
});

describe("killActiveGame", () => {
  it("returns early when no process is being tracked", async () => {
    const result = await killActiveGame();

    expect(result.ok).toBe(false);
    expect(result.message).toBe("No active Jackbox process is being tracked.");
    expect(result.pid).toBeUndefined();
  });
});
