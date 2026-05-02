# Jackbox Universe

Jackbox Universe is a Windows-first desktop launcher for locally installed Jackbox Party Pack games. The goal is to present every discovered mini-game in one unified, living-room-friendly library so players can browse, filter, customise metadata, and launch games without manually opening each Party Pack menu first.

This project is not affiliated with, endorsed by, or sponsored by Jackbox Games. It is a local launcher for games the user already owns and has installed.

## Current Status

This is an early MVP focused on library discovery and launching.

Implemented now:

- Windows Electron desktop app with a React renderer.
- Local scan for installed Jackbox pack folders.
- Manual folder picker for standalone or missed installations.
- Shortcut support — `.lnk` and `.url` shortcuts to Jackbox executables are resolved.
- Cache validation on launch — missing pack paths are cleaned up automatically.
- Local metadata extraction from `jbg.config`, `manifest.json`, and XML files.
- Picker metadata extraction from `games/Picker` or `games/PartyPack` content and localisation files.
- Manual metadata overrides for display name, description, player counts, game type, and audience support.
- Duplicate detection for matching games found in multiple install locations.
- Duplicate-resolution UI for choosing the preferred installation.
- Library grid grouped by Party Pack by default.
- Search, player count, game type, audience, and alphabetical sort controls.
- Banner artwork from JackboxGames.com (with name-matched tile detection) and SteamGridDB (when an API key is configured).
- Foreign-language artwork rejection (Russian, German, French, etc. via URL pattern matching).
- Content-hash deduplication — different games can never receive the same image.
- Artwork download progress bar in the status strip.
- "Clear Artwork Cache & Re-download" button in Settings.
- Friendly pack names — dots in folder names like `The.Jackbox.Party.Pack.10` are replaced with spaces.
- Direct game launch with multi-stage fallback: `-launchTo` with `isBundle=false` → `-launchTo` alone → pack menu.
- Active process tracking, launcher minimising, restore on exit, and `Ctrl+Q` force-close.
- Custom app icon (Jackbox logo).
- Portable Windows build through `electron-builder`.
- Playwright-based audit tools (`npm run audit`, `npm run audit:artwork`).
- 93 automated tests across 7 test files including real-process launch/kill integration tests.

Not implemented yet:

- Audio cues.
- Gamepad navigation.
- System tray integration.
- Installer builds.
- Code signing (the portable build uses `signAndEditExecutable: false`).

## How It Works

Jackbox Universe does not read Steam, Epic, or other storefront databases. It searches the filesystem for folders that look like Jackbox Party Pack installations:

- an executable file with `Jackbox` in the filename
- an adjacent `games` directory

Manual scan folders can also contain shortcuts. Windows `.lnk` shortcuts are resolved to their local target/working directory, and local file `.url` shortcuts are resolved when they point directly to an installed executable. Storefront launch URLs still rely on the normal filesystem scan finding the installed pack folder.

For each game folder inside `games`, the app first checks the pack picker metadata in `games/Picker/content.json` or `games/PartyPack/content.json`, resolving localised game names and descriptions through adjacent `Localization.json` files where available. This is the best local source for display names, player counts, picker tags, audience support, and the exact SWF target used by the pack itself. If picker metadata is missing, the app falls back to per-game config files.

If a direct SWF target can be confirmed, the launcher attempts direct launch using literal forward slashes:

```text
-launchTo games/<InternalName>/<InternalName>.swf -jbg.config isBundle=false
```

If the game exits quickly (within 1.5 seconds), the launcher retries without `-jbg.config isBundle=false` (some packs reject that flag). If that also fails, it falls back to launching the pack menu with no arguments.

## Requirements

- Windows 10 or newer.
- Node.js 22 or newer is recommended.
- npm.
- Locally installed Jackbox games.

The app is currently Windows-focused. Other platforms are not supported by the MVP.

## Install Dependencies

```powershell
npm install
```

## Run In Development

```powershell
npm run dev
```

This starts Vite and Electron together.

If Electron exits immediately in a custom shell, check that `ELECTRON_RUN_AS_NODE` is not set. The dev script clears it for Electron, but a globally configured environment can still affect manually launched Electron commands.

## Test And Build

Run the full validation pipeline:

```powershell
npm run build
```

This runs:

- clean
- TypeScript typecheck
- Vitest tests
- Electron main/preload build
- renderer production build

Run tests only:

```powershell
npm test
```

Watch tests:

```powershell
npm run test:watch
```

## Build A Portable Windows App

```powershell
npm run package:win
```

The portable executable is written to:

```text
release/Jackbox-Universe-0.2.0.exe
```

The unpacked app is written to:

```text
release/win-unpacked/
```

The current portable build is unsigned and uses Electron's default icon.

## Using The App

1. Open Jackbox Universe.
2. Select `Scan Library` to search common Windows install locations.
3. Select `Add Folder` if a pack was not found automatically.
4. Resolve duplicate installations if prompted.
5. Use filters to narrow the library by game name, pack, player count, type, or audience support.
6. Select `Launch Game` where direct launch is supported.
7. Select `Launch Pack Menu` where the MVP cannot confirm direct mini-game launch support.
8. Right-click a game tile, or select `Customise`, to edit local metadata overrides.
9. Add a SteamGridDB API key in `Settings` to download cached grid banners for discovered games.
10. Use `Ctrl+Q` to force-close the tracked active game process and return focus to the launcher.

## Local Data

Jackbox Universe stores local app state with `electron-store`, including:

- discovered pack paths
- manually added scan roots
- duplicate choices
- metadata overrides
- downloaded artwork cache entries
- settings

No external metadata service is used for game text in the MVP. SteamGridDB is only queried for image assets, using locally extracted display names.

## Project Structure

```text
docs/                 Design notes and planning documents
src/main/             Electron main process, scanner, storage, launch logic
src/preload/          Safe IPC bridge exposed to the renderer
src/renderer/         React UI and styles
src/shared/           Shared TypeScript types
tests/                Unit and renderer tests
dist/                 Generated build output
release/              Generated packaged app output
```

## Scripts

```text
npm run dev           Run Vite and Electron for development
npm run typecheck     Type-check the project
npm test              Run Vitest once (93 tests, 7 files)
npm run test:watch    Run Vitest in watch mode
npm run build         Run the full validation and build pipeline
npm run package:win   Build the portable Windows executable
npm run clean         Remove dist and release outputs
npm run audit         Playwright screenshot + missing-artwork report
npm run audit:artwork HTML page showing all cached banners
```

## Roadmap

Planned next work:

- Add a custom app icon and package metadata polish.
- Add audio cues with a setting to disable them.
- Add HTML5 Gamepad API navigation.
- Improve direct-launch compatibility with per-pack/per-engine rules.
- Add better launch diagnostics when a game fails to start.
- Add system tray behaviour after launch.
- Add broader integration tests for Electron IPC workflows.

## Known Limitations

- Direct mini-game launch uses a best-effort fallback chain: some very old packs (Pack 1, Pack 2) may only open the pack menu.
- Some Jackbox packs may require loader-style behaviour that this project intentionally does not implement.
- The scanner only recognises pack folders with a `Jackbox` executable and adjacent `games` folder.
- Metadata quality depends on the installed local files; older packs without readable picker metadata may need manual overrides.
- The current package is unsigned, so Windows may show SmartScreen or trust prompts.
- Game process kill uses Windows `taskkill` against the tracked PID tree.
- Artwork downloads depend on the availability of JackboxGames.com and SteamGridDB; some games may show CSS-generated fallback banners.

## Development Notes

- Keep user-facing copy in Australian/British English.
- Generated folders such as `dist/`, `release/`, `node_modules/`, and temporary test fixtures should not be committed.
- If packaging fails while extracting signing helpers on Windows, the build is configured with `signAndEditExecutable: false` for the unsigned portable MVP.

## Licence

This repository is currently marked `UNLICENSED` in `package.json`.
