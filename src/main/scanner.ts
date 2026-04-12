import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DuplicateGroup,
  GameInstallation,
  LibraryGame,
  LibraryState,
  MetadataOverride,
  PackInstallation
} from "../shared/types.js";
import { applyMetadataOverride, extractGameMetadata } from "./metadata.js";
import { normaliseKey, stableHash } from "./hash.js";

const ignoredFolders = new Set([".git", "node_modules", "$recycle.bin", "windows", "system volume information", "appdata"]);

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
  const checked = await Promise.all(paths.map(async (packPath) => ((await isPackRoot(packPath)) ? packPath : undefined)));
  return [...new Set(checked.filter((packPath): packPath is string => Boolean(packPath)))];
}

export async function discoverPackRoots(roots: string[], maxDepth = 7): Promise<string[]> {
  const discovered = await Promise.all(roots.map((root) => discoverFromRoot(root, maxDepth)));
  return [...new Set(discovered.flat())];
}

export async function buildLibrary(
  packPaths: string[],
  duplicatePreferences: Record<string, string>,
  metadataOverrides: Record<string, MetadataOverride>,
  lastScanAt?: string
): Promise<LibraryState> {
  const packs = await Promise.all(packPaths.map(readPackInstallation));
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
  const encodedTarget = `games%2F${installation.internalName}%2F${installation.internalName}.swf`;
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

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !ignoredFolders.has(entry.name.toLowerCase()))
        .map((entry) => visit(path.join(folder, entry.name), depth + 1))
    );
  }

  await visit(root, 0);
  return found;
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

  const gameFolders = entries.filter((entry) => entry.isDirectory());
  return Promise.all(
    gameFolders.map(async (entry) => {
      const folderPath = path.join(pack.gamesPath, entry.name);
      const internalName = entry.name;
      const baseMetadata = await extractGameMetadata(folderPath);
      const duplicateKey = `${normaliseKey(baseMetadata.displayName)}::${normaliseKey(internalName)}`;
      const metadata = applyMetadataOverride(baseMetadata, metadataOverrides[duplicateKey]);
      const directLaunchSupported = await exists(path.join(folderPath, `${internalName}.swf`));

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
        directLaunchSupported,
        launchLabel: directLaunchSupported ? "Launch Game" : "Launch Pack Menu"
      } satisfies GameInstallation;
    })
  );
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
