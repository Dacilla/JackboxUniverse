import { contextBridge, ipcRenderer } from "electron";
import type { HydrationProgress, JackboxUniverseApi, MetadataOverride, ScanOptions, Settings } from "../shared/types.js";

const api: JackboxUniverseApi = {
  scanLibrary: (options?: ScanOptions) => ipcRenderer.invoke("library:scan", options),
  addManualFolder: (path?: string) => ipcRenderer.invoke("library:addManualFolder", path),
  getLibrary: () => ipcRenderer.invoke("library:get"),
  saveMetadataOverride: (gameId: string, override: MetadataOverride) =>
    ipcRenderer.invoke("library:saveMetadataOverride", gameId, override),
  chooseDuplicate: (gameId: string, installationId: string) =>
    ipcRenderer.invoke("library:chooseDuplicate", gameId, installationId),
  launchGame: (gameId: string) => ipcRenderer.invoke("game:launch", gameId),
  killActiveGame: () => ipcRenderer.invoke("game:killActive"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Settings) => ipcRenderer.invoke("settings:save", settings),
  onProgress: (callback: (progress: HydrationProgress) => void) => {
    function handler(_event: Electron.IpcRendererEvent, progress: HydrationProgress): void {
      callback(progress);
    }
    ipcRenderer.on("library:hydration-progress", handler);
    return () => {
      ipcRenderer.removeListener("library:hydration-progress", handler);
    };
  },
  clearArtworkCache: () => ipcRenderer.invoke("library:clearArtworkCache")
};

contextBridge.exposeInMainWorld("jackboxUniverse", api);
