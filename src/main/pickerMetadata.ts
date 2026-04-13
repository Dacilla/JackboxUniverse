import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import type { ExtractedMetadata } from "./metadata.js";

export interface PickerGameMetadata extends ExtractedMetadata {
  internalName: string;
  launchTarget?: string;
}

interface PickerEntry {
  name?: unknown;
  mainSwf?: unknown;
  title?: unknown;
  players?: unknown;
  family?: unknown;
  audience?: unknown;
  description?: unknown;
  descriptionFile?: unknown;
  tagline?: unknown;
  menu?: unknown;
  icons?: unknown;
  enabled?: unknown;
}

interface PickerSource {
  pickerPath: string;
  entries: PickerEntry[];
  archive?: AssetArchive;
}

interface AssetArchiveEntry {
  compressedSize: number;
  dataStart: number;
  method: number;
}

interface AssetArchive {
  buffer: Buffer;
  entries: Map<string, AssetArchiveEntry>;
}

const pickerFolderNames = ["Picker", "PartyPack"];
const genericIconTags = new Set(["TIME", "PLAYERS", "FAMILY", "NOTFAMILY"]);
const gameTypeLabels: Record<string, string> = {
  DRAWING: "Drawing",
  TRIVIA: "Trivia",
  WRITING: "Writing",
  MUSIC: "Music",
  OUTLOUD: "Out loud",
  HIDDENID: "Hidden identity",
  TEAMS: "Teams",
  CHANCE: "Chance",
  ROLEPLAY: "Role play",
  HEAD2HEAD: "Head to head",
  POPCULTURE: "Pop culture"
};

export async function readPickerMetadata(packPath: string): Promise<Map<string, PickerGameMetadata>> {
  const source = await readPickerSource(packPath);
  if (!source) return new Map();

  const localisation = await readLocalisation(source);
  const metadata = new Map<string, PickerGameMetadata>();

  await Promise.all(
    source.entries.map(async (entry) => {
      const internalName = readString(entry.name);
      const mainSwf = readString(entry.mainSwf);
      if (!internalName || !mainSwf || entry.enabled === false) return;

      const iconTags = readIconTags(entry.icons);
      const playerRange = readPlayerRange(readString(entry.players)) ?? readPlayerRangeFromIcons(entry.icons);
      const description = await readDescription(packPath, source, entry, localisation);

      metadata.set(internalName.toLowerCase(), {
        internalName,
        launchTarget: toLaunchTarget(internalName, mainSwf),
        displayName:
          localise(readString(entry.menu), localisation) ??
          readString(entry.title) ??
          readString(entry.menu) ??
          internalName,
        description,
        minPlayers: playerRange?.minPlayers,
        maxPlayers: playerRange?.maxPlayers,
        gameType: readGameType(iconTags),
        audienceSupported: await readAudienceSupported(packPath, internalName, entry),
      });
    })
  );

  return metadata;
}

async function readPickerSource(packPath: string): Promise<PickerSource | undefined> {
  for (const folderName of pickerFolderNames) {
    const pickerPath = path.join(packPath, "games", folderName);
    const content = await readJson(path.join(pickerPath, "content.json"));
    const entries = Array.isArray(content?.games) ? content.games : Array.isArray(content?.content) ? content.content : undefined;
    if (entries) return { pickerPath, entries: entries as PickerEntry[] };
  }

  const archive = await readAssetArchive(path.join(packPath, "assets.bin"));
  if (!archive) return undefined;

  for (const folderName of pickerFolderNames) {
    const content = readArchivedJson(archive, `games/${folderName}/content.json`);
    const entries = Array.isArray(content?.games) ? content.games : Array.isArray(content?.content) ? content.content : undefined;
    if (entries) {
      return {
        pickerPath: path.join(packPath, "games", folderName),
        entries: entries as PickerEntry[],
        archive
      };
    }
  }

  return undefined;
}

async function readDescription(
  packPath: string,
  source: PickerSource,
  entry: PickerEntry,
  localisation: Record<string, string>
): Promise<string> {
  const description = readString(entry.description);
  const tagline = readString(entry.tagline);
  const localised =
    localise(description, localisation) ??
    localise(tagline, localisation);
  if (localised) return localised;

  const inlineDescription = readInlineDescription(description) ?? readInlineDescription(tagline);
  if (inlineDescription) return inlineDescription;

  const descriptionFile = readString(entry.descriptionFile);
  if (!descriptionFile) return "";

  if (source.archive) {
    const archivePath = toPickerArchivePath(packPath, source.pickerPath, descriptionFile);
    return archivePath ? stripHtml(readArchivedText(source.archive, archivePath) ?? "") : "";
  }

  const pickerPath = source.pickerPath;
  const resolved = path.resolve(pickerPath, descriptionFile);
  if (!isWithinFolder(pickerPath, resolved) && !isWithinFolder(packPath, resolved)) return "";

  try {
    return stripHtml(await fs.readFile(resolved, "utf8"));
  } catch {
    return "";
  }
}

async function readAudienceSupported(packPath: string, internalName: string, entry: PickerEntry): Promise<boolean | undefined> {
  const explicitAudience = readBoolean(entry.audience);
  if (explicitAudience !== undefined) return explicitAudience;

  const settings = await readJson(path.join(packPath, "games", internalName, "settings.json"));
  if (!settings || typeof settings !== "object") return undefined;
  return containsSource(settings, "AudienceOn") ? true : undefined;
}

async function readLocalisation(source: PickerSource): Promise<Record<string, string>> {
  const packPath = path.dirname(path.dirname(source.pickerPath));
  const archivePath = toPickerArchivePath(packPath, source.pickerPath, "Localization.json");
  const localisation =
    source.archive
      ? readArchivedJson(source.archive, archivePath)
      : await readJson(path.join(source.pickerPath, "Localization.json"));
  const tableContainer = localisation?.table;
  const table = tableContainer && typeof tableContainer === "object" ? (tableContainer as Record<string, unknown>).en : undefined;
  if (!table || typeof table !== "object") return {};
  return Object.fromEntries(Object.entries(table).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function readJson(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function readAssetArchive(filePath: string): Promise<AssetArchive | undefined> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return undefined;
  }

  const entries = new Map<string, AssetArchiveEntry>();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    const isFirstJackboxSignature = offset === 0 && buffer.subarray(0, 4).toString("ascii") === "JBGP";
    if (signature !== 0x04034b50 && !isFirstJackboxSignature) break;

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const dataStart = fileNameStart + fileNameLength + extraLength;
    const nextOffset = dataStart + compressedSize;
    if (dataStart > buffer.length || nextOffset > buffer.length) break;

    const fileName = buffer.subarray(fileNameStart, fileNameStart + fileNameLength).toString("utf8");
    entries.set(normaliseArchivePath(fileName).toLowerCase(), { compressedSize, dataStart, method });
    offset = nextOffset;
  }

  return entries.size ? { buffer, entries } : undefined;
}

function readArchivedJson(archive: AssetArchive, archivePath?: string): Record<string, unknown> | undefined {
  const raw = readArchivedText(archive, archivePath);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readArchivedText(archive: AssetArchive, archivePath?: string): string | undefined {
  if (!archivePath) return undefined;
  const entry = archive.entries.get(normaliseArchivePath(archivePath).toLowerCase());
  if (!entry) return undefined;

  const compressed = archive.buffer.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  try {
    if (entry.method === 0) return compressed.toString("utf8");
    if (entry.method === 8) return inflateRawSync(compressed).toString("utf8");
  } catch {
    return undefined;
  }
  return undefined;
}

function readPlayerRangeFromIcons(icons: unknown): { minPlayers: number; maxPlayers: number } | undefined {
  if (!Array.isArray(icons)) return undefined;
  const playerIcon = icons.find((icon) => {
    return icon && typeof icon === "object" && readString((icon as Record<string, unknown>).tag)?.toUpperCase() === "PLAYERS";
  }) as Record<string, unknown> | undefined;
  return readPlayerRange(readString(playerIcon?.value));
}

function readPlayerRange(value?: string): { minPlayers: number; maxPlayers: number } | undefined {
  if (!value) return undefined;
  const range = value.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return { minPlayers: Number.parseInt(range[1], 10), maxPlayers: Number.parseInt(range[2], 10) };

  const single = value.match(/(\d+)/);
  if (single) {
    const players = Number.parseInt(single[1], 10);
    return { minPlayers: players, maxPlayers: players };
  }
  return undefined;
}

function readIconTags(icons: unknown): string[] {
  if (!Array.isArray(icons)) return [];
  return icons
    .map((icon) => (icon && typeof icon === "object" ? readString((icon as Record<string, unknown>).tag)?.toUpperCase() : undefined))
    .filter((tag): tag is string => Boolean(tag));
}

function readGameType(iconTags: string[]): string | undefined {
  const tag = iconTags.find((candidate) => !genericIconTags.has(candidate));
  return tag ? gameTypeLabels[tag] ?? toTitleCase(tag) : undefined;
}

function containsSource(value: unknown, source: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsSource(item, source));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => (key === "source" && child === source) || containsSource(child, source));
}

function localise(key: string | undefined, localisation: Record<string, string>): string | undefined {
  if (!key) return undefined;
  return localisation[key]?.trim() || undefined;
}

function readInlineDescription(value: string | undefined): string | undefined {
  if (!value || isLikelyLocalisationKey(value)) return undefined;
  return stripHtml(value);
}

function isLikelyLocalisationKey(value: string): boolean {
  return /^[A-Z0-9_.-]+$/.test(value) && value.includes("_");
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalised = value.toLowerCase().trim();
  if (["true", "yes", "1", "supported"].includes(normalised)) return true;
  if (["false", "no", "0", "unsupported"].includes(normalised)) return false;
  return undefined;
}

function toLaunchTarget(internalName: string, mainSwf: string): string {
  return ["games", internalName, mainSwf.replaceAll("\\", "/")].join("/");
}

function toPickerArchivePath(packPath: string, pickerPath: string, relativePath: string): string | undefined {
  if (path.isAbsolute(relativePath)) return undefined;

  const resolved = path.resolve(pickerPath, relativePath);
  if (!isWithinFolder(pickerPath, resolved) && !isWithinFolder(packPath, resolved)) return undefined;

  return normaliseArchivePath(path.relative(packPath, resolved));
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isWithinFolder(folder: string, target: string): boolean {
  const relative = path.relative(folder, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normaliseArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}
