export interface ScanOptions {
  roots?: string[];
}

export interface MetadataOverride {
  displayName?: string;
  description?: string;
  minPlayers?: number;
  maxPlayers?: number;
  gameType?: string;
  audienceSupported?: boolean;
}

export interface Settings {
  steamGridDbApiKey?: string;
  preferReducedMotion: boolean;
}

export type BannerSource = "jackbox" | "steamgriddb";

export type ArtworkCacheStatus = "available" | "missing" | "error";

export interface ArtworkCacheEntry {
  status: ArtworkCacheStatus;
  displayName: string;
  updatedAt: string;
  cacheVersion?: number;
  localPath?: string;
  sourceUrl?: string;
  source?: BannerSource;
  steamGridDbGameId?: number;
  steamGridDbGridId?: number;
  errorMessage?: string;
}

export interface PackInstallation {
  packId: string;
  packName: string;
  packPath: string;
  executablePath: string;
  gamesPath: string;
}

export interface GameInstallation {
  installationId: string;
  gameId: string;
  duplicateKey: string;
  packId: string;
  packName: string;
  packPath: string;
  executablePath: string;
  gamesPath: string;
  internalName: string;
  folderPath: string;
  displayName: string;
  description: string;
  minPlayers?: number;
  maxPlayers?: number;
  gameType?: string;
  audienceSupported?: boolean;
  launchTarget?: string;
  directLaunchSupported: boolean;
  launchLabel: "Launch Game" | "Launch Pack Menu";
  bannerUrl?: string;
  bannerSource?: BannerSource;
}

export interface LibraryGame {
  gameId: string;
  duplicateKey: string;
  selectedInstallationId: string;
  hasDuplicateChoices: boolean;
  needsDuplicateChoice: boolean;
  installations: GameInstallation[];
  selected: GameInstallation;
}

export interface DuplicateGroup {
  gameId: string;
  displayName: string;
  selectedInstallationId?: string;
  installations: GameInstallation[];
}

export interface LibraryState {
  packs: PackInstallation[];
  games: LibraryGame[];
  duplicates: DuplicateGroup[];
  lastScanAt?: string;
}

export interface LaunchResult {
  ok: boolean;
  pid?: number;
  mode?: "direct" | "pack-menu";
  message: string;
}

export interface StoredState {
  packPaths: string[];
  manualRoots: string[];
  duplicatePreferences: Record<string, string>;
  metadataOverrides: Record<string, MetadataOverride>;
  artworkCache: Record<string, ArtworkCacheEntry>;
  settings: Settings;
  lastScanAt?: string;
}

export interface JackboxUniverseApi {
  scanLibrary(options?: ScanOptions): Promise<LibraryState>;
  addManualFolder(path?: string): Promise<LibraryState>;
  getLibrary(): Promise<LibraryState>;
  saveMetadataOverride(gameId: string, override: MetadataOverride): Promise<LibraryState>;
  chooseDuplicate(gameId: string, installationId: string): Promise<LibraryState>;
  launchGame(gameId: string): Promise<LaunchResult>;
  killActiveGame(): Promise<LaunchResult>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  onProgress(callback: (progress: HydrationProgress) => void): () => void;
  clearArtworkCache(): Promise<LibraryState>;
}

export interface HydrationProgress {
  current: number;
  total: number;
  displayName: string;
}
