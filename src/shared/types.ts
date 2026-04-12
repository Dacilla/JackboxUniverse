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
  directLaunchSupported: boolean;
  launchLabel: "Launch Game" | "Launch Pack Menu";
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
}
