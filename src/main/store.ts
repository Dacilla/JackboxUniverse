import Store from "electron-store";
import type { ArtworkCacheEntry, MetadataOverride, Settings, StoredState } from "../shared/types.js";

const defaultSettings: Settings = {
  steamGridDbApiKey: "",
  preferReducedMotion: false
};

const store = new Store<StoredState>({
  name: "jackbox-universe",
  defaults: {
    packPaths: [],
    manualRoots: [],
    duplicatePreferences: {},
    metadataOverrides: {},
    artworkCache: {},
    settings: defaultSettings,
    lastScanAt: undefined
  }
});

export function getPackPaths(): string[] {
  return uniqueStrings(store.get("packPaths", []));
}

export function setPackPaths(paths: string[]): void {
  store.set("packPaths", uniqueStrings(paths));
}

export function getManualRoots(): string[] {
  return uniqueStrings(store.get("manualRoots", []));
}

export function addManualRoot(path: string): void {
  store.set("manualRoots", uniqueStrings([...getManualRoots(), path]));
}

export function getDuplicatePreferences(): Record<string, string> {
  return store.get("duplicatePreferences", {});
}

export function setDuplicatePreference(gameId: string, installationId: string): void {
  store.set("duplicatePreferences", { ...getDuplicatePreferences(), [gameId]: installationId });
}

export function getMetadataOverrides(): Record<string, MetadataOverride> {
  return store.get("metadataOverrides", {});
}

export function setMetadataOverride(gameId: string, override: MetadataOverride): void {
  store.set("metadataOverrides", { ...getMetadataOverrides(), [gameId]: stripEmptyOverride(override) });
}

export function getArtworkCache(): Record<string, ArtworkCacheEntry> {
  return store.get("artworkCache", {});
}

export function setArtworkCache(cache: Record<string, ArtworkCacheEntry>): void {
  store.set("artworkCache", cache);
}

export function getSettings(): Settings {
  return { ...defaultSettings, ...store.get("settings", defaultSettings) };
}

export function setSettings(settings: Settings): Settings {
  const next = { ...defaultSettings, ...settings };
  store.set("settings", next);
  return next;
}

export function getLastScanAt(): string | undefined {
  return store.get("lastScanAt");
}

export function setLastScanAt(value: string): void {
  store.set("lastScanAt", value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

function stripEmptyOverride(override: MetadataOverride): MetadataOverride {
  const next: MetadataOverride = {};
  if (override.displayName?.trim()) next.displayName = override.displayName.trim();
  if (override.description?.trim()) next.description = override.description.trim();
  if (Number.isFinite(override.minPlayers)) next.minPlayers = override.minPlayers;
  if (Number.isFinite(override.maxPlayers)) next.maxPlayers = override.maxPlayers;
  if (override.gameType?.trim()) next.gameType = override.gameType.trim();
  if (typeof override.audienceSupported === "boolean") next.audienceSupported = override.audienceSupported;
  return next;
}
