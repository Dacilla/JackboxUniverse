import { promises as fs, type Dirent } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DuplicateGroup,
  GameInstallation,
  LibraryGame,
  LibraryState,
  MetadataOverride,
  PackInstallation
} from "../shared/types.js";
import { applyMetadataOverride, extractGameMetadata } from "./metadata.js";
import { readPickerMetadata, type PickerGameMetadata } from "./pickerMetadata.js";
import { normaliseKey, stableHash } from "./hash.js";

const ignoredFolders = new Set([".git", "node_modules", "$recycle.bin", "windows", "system volume information", "appdata"]);
const ignoredGameFolders = new Set(["partypack", "picker"]);

export async function getDefaultScanRoots(): Promise<string[]> {
  const roots = [
    "C:\\Program Files (x86)\\Steam\\steamapps\\common",
    "C:\\Program Files\\Steam\\steamapps\\common",
    "C:\\Program Files\\Epic Games",
    "C:\\Program Files (x86)\\Epic Games",
    "C:\\GOG Games",
    "D:\\SteamLibrary\\steamapps\\common",
    "D:\\Epic Games",
    "D:\\GOG Games",
    path.join(os.homedir(), "Games")
  ];
  const existing = await Promise.all(roots.map(async (root) => ((await exists(root)) ? root : undefined)));
  return existing.filter((root): root is string => Boolean(root));
}

export async function validatePackPaths(paths: string[]): Promise<string[]> {
  const normalisedPaths = [...new Set(paths.filter(isNonEmptyString).map(normaliseFileSystemPath))];
  const checked = await Promise.all(normalisedPaths.map(async (packPath) => ((await isPackRoot(packPath)) ? packPath : undefined)));
  return [...new Set(checked.filter((packPath): packPath is string => Boolean(packPath)))];
}

export async function discoverPackRoots(roots: string[], maxDepth = 7): Promise<string[]> {
  const discovered = await Promise.all(roots.map((root) => discoverFromRoot(root, maxDepth)));
  return [...new Set(discovered.flat().filter(isNonEmptyString).map(normaliseFileSystemPath))];
}

export async function buildLibrary(
  packPaths: string[],
  duplicatePreferences: Record<string, string>,
  metadataOverrides: Record<string, MetadataOverride>,
  lastScanAt?: string
): Promise<LibraryState> {
  const packs = await Promise.all([...new Set(packPaths.filter(isNonEmptyString).map(normaliseFileSystemPath))].map(readPackInstallation));
  const validPacks = packs.filter((pack): pack is PackInstallation => Boolean(pack));
  const gameGroups = await Promise.all(validPacks.map((pack) => readGameInstallations(pack, metadataOverrides)));
  const grouped = groupByDuplicateKey(gameGroups.flat());
  const games: LibraryGame[] = [];
  const duplicates: DuplicateGroup[] = [];

  for (const [duplicateKey, group] of grouped) {
    const preference = duplicatePreferences[duplicateKey];
    const selected = group.find((installation) => installation.installationId === preference) ?? group[0];
    const hasDuplicates = group.length > 1;
    games.push({
      gameId: duplicateKey,
      duplicateKey,
      selectedInstallationId: selected.installationId,
      hasDuplicateChoices: hasDuplicates,
      needsDuplicateChoice: hasDuplicates && !preference,
      installations: group,
      selected
    });
    if (hasDuplicates) {
      duplicates.push({
        gameId: duplicateKey,
        displayName: selected.displayName,
        selectedInstallationId: preference,
        installations: group
      });
    }
  }

  games.sort((a, b) => a.selected.displayName.localeCompare(b.selected.displayName));
  duplicates.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { packs: validPacks, games, duplicates, lastScanAt };
}

export function getLaunchArguments(installation: GameInstallation): string[] {
  if (!installation.directLaunchSupported) return [];
  const target = installation.launchTarget ?? `games/${installation.internalName}/${installation.internalName}.swf`;
  const encodedTarget = encodeURIComponent(target.replaceAll("\\", "/"));
  return ["-launchTo", encodedTarget, "-jbg.config", "isBundle=false"];
}

async function discoverFromRoot(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];

  async function visit(folder: string, depth: number): Promise<void> {
    if (depth > maxDepth || ignoredFolders.has(path.basename(folder).toLowerCase())) return;
    if (await isPackRoot(folder)) {
      found.push(folder);
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }

    found.push(...(await discoverFromShortcuts(folder, entries)));

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !ignoredFolders.has(entry.name.toLowerCase()))
        .map((entry) => visit(path.join(folder, entry.name), depth + 1))
    );
  }

  await visit(root, 0);
  return [...new Set(found)];
}

async function discoverFromShortcuts(folder: string, entries: Dirent[]): Promise<string[]> {
  const shortcuts = entries.filter((entry) => entry.isFile() && isShortcutFile(entry.name));
  if (shortcuts.length === 0) return [];

  const discovered = await Promise.all(shortcuts.map((entry) => discoverFromShortcut(path.join(folder, entry.name))));
  return [...new Set(discovered.flat())];
}

async function discoverFromShortcut(shortcutPath: string): Promise<string[]> {
  const candidates = await resolveShortcutCandidates(shortcutPath);
  const possiblePackRoots = candidates.flatMap(candidatePackRootsFromShortcutTarget);
  const checked = await Promise.all(
    possiblePackRoots.map(async (candidate) => ((await isPackRoot(candidate)) ? candidate : undefined))
  );
  return [...new Set(checked.filter((candidate): candidate is string => Boolean(candidate)))];
}

async function resolveShortcutCandidates(shortcutPath: string): Promise<string[]> {
  const extension = path.extname(shortcutPath).toLowerCase();
  if (extension === ".url") return resolveUrlShortcutCandidates(shortcutPath);
  if (extension === ".lnk") return resolveWindowsShortcutCandidates(shortcutPath);
  return [];
}

async function resolveUrlShortcutCandidates(shortcutPath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(shortcutPath, "utf8");
  } catch {
    return [];
  }

  const urlLine = raw.split(/\r?\n/).find((line) => line.trim().toLowerCase().startsWith("url="));
  if (!urlLine) return [];

  const target = urlLine.replace(/^url=/i, "").trim();
  return coerceShortcutTargetToLocalPath(target);
}

async function resolveWindowsShortcutCandidates(shortcutPath: string): Promise<string[]> {
  if (process.platform !== "win32") return [];

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$shortcutPath = [Environment]::GetEnvironmentVariable('JACKBOX_UNIVERSE_SHORTCUT_PATH', 'Process')",
    "$shell = New-Object -ComObject WScript.Shell",
    "$shortcut = $shell.CreateShortcut($shortcutPath)",
    "[pscustomobject]@{ TargetPath = $shortcut.TargetPath; WorkingDirectory = $shortcut.WorkingDirectory } | ConvertTo-Json -Compress"
  ].join("\n");

  try {
    const stdout = await execFileText(getPowerShellPath(), [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ], { JACKBOX_UNIVERSE_SHORTCUT_PATH: shortcutPath });
    const parsed = JSON.parse(stdout.trim()) as { TargetPath?: unknown; WorkingDirectory?: unknown };
    return [parsed.TargetPath, parsed.WorkingDirectory].filter(isNonEmptyString);
  } catch {
    return [];
  }
}

function execFileText(command: string, args: string[], envOverrides?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", env: { ...process.env, ...envOverrides }, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function getPowerShellPath(): string {
  return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function candidatePackRootsFromShortcutTarget(target: string): string[] {
  const localPaths = coerceShortcutTargetToLocalPath(target);
  return localPaths.map((localPath) => (path.extname(localPath).toLowerCase() === ".exe" ? path.dirname(localPath) : localPath));
}

function coerceShortcutTargetToLocalPath(target: string): string[] {
  if (!target) return [];
  if (/^[a-z]+:\/\//i.test(target) && !target.toLowerCase().startsWith("file://")) return [];
  if (target.toLowerCase().startsWith("file://")) {
    try {
      return [fileURLToPath(target)];
    } catch {
      return [];
    }
  }
  if (/^[a-z]:[\\/]/i.test(target) || target.startsWith("\\\\")) return [target];
  return [];
}

function isShortcutFile(fileName: string): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return extension === ".lnk" || extension === ".url";
}

function normaliseFileSystemPath(value: string): string {
  return path.resolve(value.trim());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function isPackRoot(folder: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return false;
  }
  const hasGames = entries.some((entry) => entry.isDirectory() && entry.name.toLowerCase() === "games");
  const hasJackboxExe = entries.some(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe") && entry.name.toLowerCase().includes("jackbox")
  );
  return hasGames && hasJackboxExe;
}

async function readPackInstallation(packPath: string): Promise<PackInstallation | undefined> {
  let entries;
  try {
    entries = await fs.readdir(packPath, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const executable = entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe") && entry.name.toLowerCase().includes("jackbox")
  );
  if (!executable) return undefined;

  return {
    packId: `pack-${stableHash(packPath.toLowerCase())}`,
    packName: path.basename(packPath),
    packPath,
    executablePath: path.join(packPath, executable.name),
    gamesPath: path.join(packPath, "games")
  };
}

async function readGameInstallations(
  pack: PackInstallation,
  metadataOverrides: Record<string, MetadataOverride>
): Promise<GameInstallation[]> {
  let entries;
  try {
    entries = await fs.readdir(pack.gamesPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const pickerMetadata = await readPickerMetadata(pack.packPath);
  const gameFolders = entries.filter((entry) => entry.isDirectory() && !ignoredGameFolders.has(entry.name.toLowerCase()));
  return Promise.all(
    gameFolders.map(async (entry) => {
      const folderPath = path.join(pack.gamesPath, entry.name);
      const internalName = entry.name;
      const baseMetadata = mergeMetadata(await extractGameMetadata(folderPath), pickerMetadata.get(internalName.toLowerCase()));
      const duplicateKey = `${normaliseKey(baseMetadata.displayName)}::${normaliseKey(internalName)}`;
      const metadata = applyMetadataOverride(baseMetadata, metadataOverrides[duplicateKey]);
      const fallbackLaunchTarget = `games/${internalName}/${internalName}.swf`;
      const launchTarget = await resolveLaunchTarget(pack.packPath, pickerMetadata.get(internalName.toLowerCase())?.launchTarget, fallbackLaunchTarget);
      const directLaunchSupported = Boolean(launchTarget);

      return {
        installationId: `install-${stableHash(`${pack.packPath.toLowerCase()}::${internalName.toLowerCase()}`)}`,
        gameId: duplicateKey,
        duplicateKey,
        packId: pack.packId,
        packName: pack.packName,
        packPath: pack.packPath,
        executablePath: pack.executablePath,
        gamesPath: pack.gamesPath,
        internalName,
        folderPath,
        displayName: metadata.displayName,
        description: metadata.description,
        minPlayers: metadata.minPlayers,
        maxPlayers: metadata.maxPlayers,
        gameType: metadata.gameType,
        audienceSupported: metadata.audienceSupported,
        launchTarget,
        directLaunchSupported,
        launchLabel: directLaunchSupported ? "Launch Game" : "Launch Pack Menu"
      } satisfies GameInstallation;
    })
  );
}

function mergeMetadata(
  fallback: Awaited<ReturnType<typeof extractGameMetadata>>,
  pickerMetadata?: PickerGameMetadata
): Awaited<ReturnType<typeof extractGameMetadata>> {
  if (!pickerMetadata) return fallback;
  return {
    displayName: pickerMetadata.displayName || fallback.displayName,
    description: pickerMetadata.description || fallback.description,
    minPlayers: pickerMetadata.minPlayers ?? fallback.minPlayers,
    maxPlayers: pickerMetadata.maxPlayers ?? fallback.maxPlayers,
    gameType: pickerMetadata.gameType || fallback.gameType,
    audienceSupported: pickerMetadata.audienceSupported ?? fallback.audienceSupported
  };
}

async function resolveLaunchTarget(
  packPath: string,
  pickerLaunchTarget: string | undefined,
  fallbackLaunchTarget: string
): Promise<string | undefined> {
  if (pickerLaunchTarget && (await exists(path.join(packPath, pickerLaunchTarget)))) return pickerLaunchTarget;
  if (await exists(path.join(packPath, fallbackLaunchTarget))) return fallbackLaunchTarget;
  return undefined;
}

function groupByDuplicateKey(installations: GameInstallation[]): Map<string, GameInstallation[]> {
  const grouped = new Map<string, GameInstallation[]>();
  for (const installation of installations) {
    const group = grouped.get(installation.duplicateKey) ?? [];
    group.push(installation);
    grouped.set(installation.duplicateKey, group);
  }
  return grouped;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
