import { promises as fs } from "node:fs";
import path from "node:path";
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

  const localisation = await readLocalisation(source.pickerPath);
  const metadata = new Map<string, PickerGameMetadata>();

  await Promise.all(
    source.entries.map(async (entry) => {
      const internalName = readString(entry.name);
      const mainSwf = readString(entry.mainSwf);
      if (!internalName || !mainSwf || entry.enabled === false) return;

      const iconTags = readIconTags(entry.icons);
      const playerRange = readPlayerRange(readString(entry.players)) ?? readPlayerRangeFromIcons(entry.icons);
      const description = await readDescription(packPath, source.pickerPath, entry, localisation);

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
  return undefined;
}

async function readDescription(
  packPath: string,
  pickerPath: string,
  entry: PickerEntry,
  localisation: Record<string, string>
): Promise<string> {
  const localised =
    localise(readString(entry.description), localisation) ??
    localise(readString(entry.tagline), localisation);
  if (localised) return localised;

  const descriptionFile = readString(entry.descriptionFile);
  if (!descriptionFile) return "";

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

async function readLocalisation(pickerPath: string): Promise<Record<string, string>> {
  const localisation = await readJson(path.join(pickerPath, "Localization.json"));
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
