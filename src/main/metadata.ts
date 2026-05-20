import { promises as fs } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { MetadataOverride } from "../shared/types.js";

export interface ExtractedMetadata {
  displayName: string;
  description: string;
  minPlayers?: number;
  maxPlayers?: number;
  gameType?: string;
  audienceSupported?: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "value"
});

const configFileNames = new Set(["jbg.config", "jbg.config.jet", "manifest.json"]);

export async function extractGameMetadata(gameFolder: string): Promise<ExtractedMetadata> {
  const internalName = path.basename(gameFolder);
  const candidates = await findMetadataFiles(gameFolder, 2);
  const values: Record<string, unknown> = {};

  for (const filePath of candidates) {
    mergeMissing(values, await parseMetadataFile(filePath));
  }

  return {
    displayName: readString(values, ["DisplayName", "displayName", "gameName", "name", "Name", "Title", "title"]) ?? internalName,
    description: readString(values, ["Description", "description", "desc", "small_description"]) ?? "",
    minPlayers: readNumber(values, ["MinPlayers", "minPlayers", "min_players", "min"]),
    maxPlayers: readNumber(values, ["MaxPlayers", "maxPlayers", "max_players", "max"]),
    gameType: readString(values, ["GameType", "gameType", "type", "Type"]),
    audienceSupported: readBoolean(values, ["AudienceSupported", "audienceSupported", "audience", "Audience"])
  };
}

export function applyMetadataOverride(metadata: ExtractedMetadata, override?: MetadataOverride): ExtractedMetadata {
  if (!override) return metadata;
  return {
    displayName: override.displayName?.trim() || metadata.displayName,
    description: override.description?.trim() || metadata.description,
    minPlayers: override.minPlayers ?? metadata.minPlayers,
    maxPlayers: override.maxPlayers ?? metadata.maxPlayers,
    gameType: override.gameType?.trim() || metadata.gameType,
    audienceSupported: override.audienceSupported ?? metadata.audienceSupported
  };
}

async function findMetadataFiles(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];

  async function visit(folder: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(folder, entry.name);
      if (entry.isFile() && isMetadataFile(entry.name, folder)) {
        found.push(entryPath);
      }
    }

    if (depth >= maxDepth) return;

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => visit(path.join(folder, entry.name), depth + 1))
    );
  }

  await visit(root, 0);
  return found;
}

function isMetadataFile(fileName: string, folder: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower === "manifest.json" && path.basename(folder).toLowerCase() === "content") return false;
  return configFileNames.has(lower) || lower.endsWith(".xml");
}

async function parseMetadataFile(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const extension = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();

  try {
    if (extension === ".json" || raw.trim().startsWith("{")) {
      return flatten(JSON.parse(raw));
    }
    if (extension === ".xml" || raw.trim().startsWith("<")) {
      return flatten(parser.parse(raw));
    }
  } catch {
    return {};
  }

  if (name === "jbg.config") {
    return parseKeyValueConfig(raw);
  }

  return {};
}

function parseKeyValueConfig(raw: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#") || clean.startsWith("//")) continue;
    const match = clean.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["'];?$/g, "").trim();
  }
  return values;
}

function flatten(value: unknown, output: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, output);
    } else {
      output[key] = child;
    }
  }
  return output;
}

function mergeMissing(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined && value !== undefined && value !== "") {
      target[key] = value;
    }
  }
}

function readString(values: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = findValue(values, key);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function readNumber(values: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = findValue(values, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

const truthyBooleans = new Set(["true", "yes", "1", "supported"]);
const falseyBooleans = new Set(["false", "no", "0", "unsupported"]);

function readBoolean(values: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = findValue(values, key);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalised = value.toLowerCase().trim();
      if (truthyBooleans.has(normalised)) return true;
      if (falseyBooleans.has(normalised)) return false;
    }
  }
  return undefined;
}

function findValue(values: Record<string, unknown>, wantedKey: string): unknown {
  const wanted = wantedKey.toLowerCase();
  return Object.entries(values).find(([key]) => key.toLowerCase() === wanted)?.[1];
}
