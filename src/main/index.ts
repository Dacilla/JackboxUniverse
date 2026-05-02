import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol } from "electron";
import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LibraryState, MetadataOverride, ScanOptions, Settings } from "../shared/types.js";
import { buildLibrary, discoverPackRoots, getDefaultScanRoots, validatePackPaths } from "./scanner.js";
import { killActiveGame, launchInstallation } from "./launcher.js";
import { hydrateLibraryArtwork } from "./artwork.js";

const artworkProtocolScheme = "jackbox-artwork";

protocol.registerSchemesAsPrivileged([
  {
    scheme: artworkProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

let mainWindow: ElectronBrowserWindow | undefined;
let storeApi: typeof import("./store.js") | undefined;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Jackbox Universe",
    icon: path.join(__dirname, "../../resources/icon.ico"),
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  storeApi = require("./store.js") as typeof import("./store.js");
  registerArtworkProtocol();
  registerIpc();
  await createWindow();
  globalShortcut.register("CommandOrControl+Q", () => {
    void killActiveGame();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

function registerIpc(): void {
  ipcMain.handle("library:get", () => loadLibrary());
  ipcMain.handle("library:scan", (_event, options?: ScanOptions) => scanLibrary(options));
  ipcMain.handle("library:addManualFolder", (_event, manualPath?: string) => addManualFolder(manualPath));
  ipcMain.handle("library:saveMetadataOverride", (_event, gameId: string, override: MetadataOverride) => {
    store().setMetadataOverride(gameId, override);
    return loadLibrary();
  });
  ipcMain.handle("library:chooseDuplicate", (_event, gameId: string, installationId: string) => {
    store().setDuplicatePreference(gameId, installationId);
    return loadLibrary();
  });
  ipcMain.handle("game:launch", async (_event, gameId: string) => {
    const library = await loadLibrary();
    const game = library.games.find((item) => item.gameId === gameId);
    if (!game || !mainWindow) {
      return { ok: false, message: "Game is not available." };
    }
    return launchInstallation(mainWindow, game.selected);
  });
  ipcMain.handle("game:killActive", () => killActiveGame());
  ipcMain.handle("settings:get", () => store().getSettings());
  ipcMain.handle("settings:save", (_event, settings: Settings) => store().setSettings(settings));
  ipcMain.handle("library:clearArtworkCache", async () => {
    store().setArtworkCache({});
    return loadLibrary();
  });
}

async function scanLibrary(options?: ScanOptions): Promise<LibraryState> {
  const validCached = await validatePackPaths(store().getPackPaths());
  store().setPackPaths(validCached);

  const roots = options?.roots?.length ? options.roots : [...(await getDefaultScanRoots()), ...store().getManualRoots()];
  const discovered = await discoverPackRoots([...new Set(roots)]);
  const packPaths = [...new Set([...validCached, ...discovered])];
  const validPackPaths = await validatePackPaths(packPaths);
  const lastScanAt = new Date().toISOString();

  store().setPackPaths(validPackPaths);
  store().setLastScanAt(lastScanAt);
  return buildAndHydrateLibrary(validPackPaths, lastScanAt);
}

async function addManualFolder(manualPath?: string): Promise<LibraryState> {
  let selectedPath = manualPath;
  if (!selectedPath && mainWindow) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Jackbox Folder",
      properties: ["openDirectory"]
    });
    selectedPath = result.canceled ? undefined : result.filePaths[0];
  }

  if (!selectedPath) return loadLibrary();

  store().addManualRoot(selectedPath);
  const discovered = await discoverPackRoots([selectedPath], 4);
  const nextPackPaths = await validatePackPaths([...store().getPackPaths(), ...discovered, selectedPath]);
  store().setPackPaths(nextPackPaths);
  store().setLastScanAt(new Date().toISOString());
  return loadLibrary();
}

async function loadLibrary(): Promise<LibraryState> {
  const validPackPaths = await validatePackPaths(store().getPackPaths());
  store().setPackPaths(validPackPaths);
  return buildAndHydrateLibrary(validPackPaths, store().getLastScanAt());
}

async function buildAndHydrateLibrary(packPaths: string[], lastScanAt?: string): Promise<LibraryState> {
  const library = await buildLibrary(packPaths, store().getDuplicatePreferences(), store().getMetadataOverrides(), lastScanAt);
  const result = await hydrateLibraryArtwork({
    library,
    apiKey: store().getSettings().steamGridDbApiKey,
    cache: store().getArtworkCache(),
    cacheDir: getArtworkCacheDir(),
    assetUrlForPath: artworkUrlForPath,
    onProgress: (current, total, displayName) => {
      mainWindow?.webContents.send("library:hydration-progress", { current, total, displayName });
    }
  });
  store().setArtworkCache(result.cache);
  return result.library;
}

function registerArtworkProtocol(): void {
  protocol.handle(artworkProtocolScheme, (request) => {
    const fileName = path.basename(decodeURIComponent(new URL(request.url).pathname));
    const resolvedPath = path.resolve(getArtworkCacheDir(), fileName);
    const resolvedCacheDir = path.resolve(getArtworkCacheDir());

    if (!resolvedPath.startsWith(`${resolvedCacheDir}${path.sep}`)) {
      return new Response("Artwork not found.", { status: 404 });
    }

    return net.fetch(pathToFileURL(resolvedPath).href);
  });
}

function getArtworkCacheDir(): string {
  return path.join(app.getPath("userData"), "steamgriddb-banners");
}

function artworkUrlForPath(localPath: string): string {
  return `${artworkProtocolScheme}://banners/${encodeURIComponent(path.basename(localPath))}`;
}

function store(): typeof import("./store.js") {
  if (!storeApi) throw new Error("Store has not been initialised.");
  return storeApi;
}
