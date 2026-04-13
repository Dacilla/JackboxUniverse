import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildLibrary, discoverPackRoots, getLaunchArguments, validatePackPaths } from "../src/main/scanner";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  fixtureRoots.length = 0;
});

async function createPack(root: string, packName: string, gameName: string, withSwf = true): Promise<string> {
  const packPath = path.join(root, packName);
  const gamePath = path.join(packPath, "games", gameName);
  await mkdir(gamePath, { recursive: true });
  await writeFile(path.join(packPath, "The Jackbox Party Pack.exe"), "");
  await writeFile(path.join(gamePath, "jbg.config"), `DisplayName=${gameName}\nMinPlayers=2\nMaxPlayers=8`);
  if (withSwf) {
    await writeFile(path.join(gamePath, `${gameName}.swf`), "");
  }
  return packPath;
}

describe("scanner", () => {
  it("discovers pack roots and stops at the pack branch", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `scan-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 3", "AwShirt");
    await mkdir(path.join(packPath, "nested", "games"), { recursive: true });

    const discovered = await discoverPackRoots([root], 5);

    expect(discovered).toEqual([packPath]);
  });

  it("validates cached pack paths", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `validate-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 4", "Fibbage");

    await expect(validatePackPaths([packPath, `${packPath}${path.sep}`, path.join(root, "missing")])).resolves.toEqual([packPath]);
  });

  it("discovers pack roots referenced by local url shortcuts", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `url-shortcuts-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 5", "SplitTheRoom");
    const shortcutRoot = path.join(root, "shortcuts");
    await mkdir(shortcutRoot, { recursive: true });
    await writeFile(
      path.join(shortcutRoot, "The Jackbox Party Pack 5.url"),
      `[InternetShortcut]\nURL=${pathToFileURL(path.join(packPath, "The Jackbox Party Pack.exe")).href}\n`
    );

    const discovered = await discoverPackRoots([shortcutRoot], 0);

    expect(discovered).toEqual([packPath]);
  });

  it.skipIf(process.platform !== "win32")("discovers pack roots referenced by Windows lnk shortcuts", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `lnk-shortcuts-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 6", "TriviaMurderParty2");
    const shortcutRoot = path.join(root, "shortcuts");
    await mkdir(shortcutRoot, { recursive: true });
    await createWindowsShortcut(
      path.join(shortcutRoot, "The Jackbox Party Pack 6.lnk"),
      path.join(packPath, "The Jackbox Party Pack.exe"),
      packPath
    );

    const discovered = await discoverPackRoots([shortcutRoot], 0);

    expect(discovered).toEqual([packPath]);
  });

  it("skips pack shell folders when building the mini-game library", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `shell-folders-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 7", "Quiplash3");
    await mkdir(path.join(packPath, "games", "Picker"), { recursive: true });
    await mkdir(path.join(packPath, "games", "PartyPack"), { recursive: true });

    const library = await buildLibrary([packPath], {}, {}, undefined);

    expect(library.games.map((game) => game.selected.internalName)).toEqual(["Quiplash3"]);
  });

  it("uses picker metadata and exact picker launch targets before content manifests", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `picker-metadata-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 3", "TriviaDeath", false);
    await writeFile(path.join(packPath, "games", "TriviaDeath", "triviadeath.swf"), "");
    await mkdir(path.join(packPath, "games", "TriviaDeath", "content"), { recursive: true });
    await writeFile(path.join(packPath, "games", "TriviaDeath", "content", "manifest.json"), JSON.stringify({ title: "Main Content Pack" }));
    await createPicker(
      packPath,
      "Picker",
      {
        games: [
          {
            name: "TriviaDeath",
            mainSwf: "triviadeath.swf",
            players: "1-8",
            family: false,
            audience: true,
            description: "INFO_DESCRIPTION_GAME_1",
            menu: "MENU_GAME_NAME_1",
            enabled: true
          }
        ]
      },
      {
        MENU_GAME_NAME_1: "Trivia Murder Party",
        INFO_DESCRIPTION_GAME_1: "Survive a serial killer's trivia show."
      }
    );

    const library = await buildLibrary([packPath], {}, {}, undefined);
    const game = library.games[0].selected;

    expect(game.displayName).toBe("Trivia Murder Party");
    expect(game.description).toBe("Survive a serial killer's trivia show.");
    expect(game.minPlayers).toBe(1);
    expect(game.maxPlayers).toBe(8);
    expect(game.audienceSupported).toBe(true);
    expect(game.launchTarget).toBe("games/TriviaDeath/triviadeath.swf");
    expect(getLaunchArguments(game)).toEqual([
      "-launchTo",
      "games%2FTriviaDeath%2Ftriviadeath.swf",
      "-jbg.config",
      "isBundle=false"
    ]);
  });

  it("uses modern PartyPack picker icon metadata for players and game type", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `party-pack-metadata-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 8", "TheWheel");
    await createPicker(
      packPath,
      "PartyPack",
      {
        content: [
          {
            name: "TheWheel",
            mainSwf: "TheWheel.swf",
            icons: [
              { tag: "TIME", value: "15-30" },
              { tag: "PLAYERS", value: "2-8" },
              { tag: "CHANCE", value: "" },
              { tag: "TRIVIA", value: "" }
            ],
            tagline: "INFO_TAGLINE_GAME_2",
            menu: "MENU_GAME_NAME_2",
            enabled: true
          }
        ]
      },
      {
        MENU_GAME_NAME_2: "The Wheel of Enormous Proportions",
        INFO_TAGLINE_GAME_2: "Spin, answer, and hope."
      }
    );

    const library = await buildLibrary([packPath], {}, {}, undefined);
    const game = library.games[0].selected;

    expect(game.displayName).toBe("The Wheel of Enormous Proportions");
    expect(game.description).toBe("Spin, answer, and hope.");
    expect(game.minPlayers).toBe(2);
    expect(game.maxPlayers).toBe(8);
    expect(game.gameType).toBe("Chance");
  });

  it("builds duplicate groups and launch arguments", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `dupes-${Date.now()}`);
    fixtureRoots.push(root);
    const first = await createPack(root, "Steam Copy", "TriviaMurderParty");
    const second = await createPack(root, "DRM Free Copy", "TriviaMurderParty");

    const library = await buildLibrary([first, second], {}, {}, undefined);
    const duplicate = library.duplicates[0];

    expect(duplicate.installations).toHaveLength(2);
    expect(library.games[0].needsDuplicateChoice).toBe(true);
    expect(getLaunchArguments(library.games[0].selected)).toEqual([
      "-launchTo",
      "games%2FTriviaMurderParty%2FTriviaMurderParty.swf",
      "-jbg.config",
      "isBundle=false"
    ]);
  });
});

function createWindowsShortcut(shortcutPath: string, targetPath: string, workingDirectory: string): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$shortcutPath = [Environment]::GetEnvironmentVariable('JACKBOX_UNIVERSE_SHORTCUT_PATH', 'Process')",
    "$targetPath = [Environment]::GetEnvironmentVariable('JACKBOX_UNIVERSE_TARGET_PATH', 'Process')",
    "$workingDirectory = [Environment]::GetEnvironmentVariable('JACKBOX_UNIVERSE_WORKING_DIRECTORY', 'Process')",
    "$shell = New-Object -ComObject WScript.Shell",
    "$shortcut = $shell.CreateShortcut($shortcutPath)",
    "$shortcut.TargetPath = $targetPath",
    "$shortcut.WorkingDirectory = $workingDirectory",
    "$shortcut.Save()"
  ].join("\n");

  return new Promise((resolve, reject) => {
    execFile(
      getPowerShellPath(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        env: {
          ...process.env,
          JACKBOX_UNIVERSE_SHORTCUT_PATH: shortcutPath,
          JACKBOX_UNIVERSE_TARGET_PATH: targetPath,
          JACKBOX_UNIVERSE_WORKING_DIRECTORY: workingDirectory
        },
        windowsHide: true
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }
    );
  });
}

function getPowerShellPath(): string {
  return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

async function createPicker(
  packPath: string,
  pickerFolderName: "Picker" | "PartyPack",
  content: Record<string, unknown>,
  localisation: Record<string, string>
): Promise<void> {
  const pickerPath = path.join(packPath, "games", pickerFolderName);
  await mkdir(pickerPath, { recursive: true });
  await writeFile(path.join(pickerPath, "content.json"), JSON.stringify(content));
  await writeFile(path.join(pickerPath, "Localization.json"), JSON.stringify({ table: { en: localisation } }));
}
