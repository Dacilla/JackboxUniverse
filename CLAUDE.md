# CLAUDE.md

This file gives coding agents baseline context for working on Jackbox Universe. Treat it as guidance, not as a substitute for reading the current code. If this file conflicts with the repository or direct user instructions, prioritise the current code and the user's request.

## Project Overview

Jackbox Universe is a Windows-first Electron desktop launcher for locally installed Jackbox Party Pack mini-games. It scans the user's filesystem for pack installations, builds a local library of mini-games, extracts metadata from installed game files, and launches games through the detected pack executable.

The project is intentionally store-agnostic:

- Do not read Steam, Epic, GOG, or other storefront databases.
- Do not require storefront launch URIs for MVP launch behaviour.
- Prefer direct executable launches against locally detected installation paths.

The app is not affiliated with Jackbox Games.

## Current Stack

- Electron main process for filesystem scanning, storage, process launching, and IPC.
- React renderer for the launcher UI.
- TypeScript throughout.
- Vite for renderer builds.
- `electron-store` for local app state.
- `fast-xml-parser` for XML metadata parsing.
- Vitest and Testing Library for tests.
- `electron-builder` for portable Windows packaging.

## Important Commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run package:win
```

`npm run build` is the main verification command. It cleans generated output, type-checks, runs tests, builds the Electron main/preload files, and builds the renderer.

`npm run package:win` builds the portable Windows executable in `release/`.

## Architecture

Important source areas:

```text
src/main/       Electron main process logic
src/preload/    Secure IPC bridge exposed to the renderer
src/renderer/   React UI and styles
src/shared/     Shared TypeScript types
tests/          Unit and renderer tests
docs/           Design and planning documents
```

Main-process responsibilities:

- validate cached pack paths at startup
- scan default and manual roots for Jackbox pack folders
- parse local metadata files
- build duplicate-aware library state
- persist local settings and overrides
- launch/kill tracked game processes
- expose safe IPC handlers

Renderer responsibilities:

- display the library
- provide filters and sorting
- show duplicate-resolution UI
- edit manual metadata overrides
- expose settings
- trigger launch and close actions through IPC only

Preload responsibilities:

- expose a minimal typed `window.jackboxUniverse` API
- avoid exposing raw Node or Electron APIs to the renderer

## Data Model Notes

The shared public types live in `src/shared/types.ts`. Prefer changing these types first when altering the IPC contract or library shape.

Key concepts:

- `PackInstallation`: one detected Party Pack install.
- `GameInstallation`: one detected mini-game within one pack install.
- `LibraryGame`: duplicate-aware game entry shown by the UI.
- `DuplicateGroup`: all detected installations for the same normalised game.
- `MetadataOverride`: user-provided edits layered on top of extracted metadata.
- `Settings`: local app settings.

Duplicate detection currently uses a normalised display-name plus internal-folder-name key. If this changes, update tests and stored preference migration behaviour.

## Scanning Rules

A folder is treated as a Jackbox pack root when it contains:

- an `.exe` file with `Jackbox` in the filename
- an adjacent `games` directory

The scanner should stop descending a branch once it finds a pack root.

Manual folder selection should accept either:

- the pack root itself
- a parent folder containing one or more pack roots

Do not add storefront-specific database readers without an explicit product decision.

## Metadata Rules

Extract text metadata from local installed files only:

- `jbg.config`
- `manifest.json`
- XML files

Fields currently extracted:

- display name
- description
- min players
- max players
- game type
- audience support

Manual overrides should always apply after extracted metadata.

Do not use IGDB or other external APIs for text metadata. SteamGridDB is planned only for image/banner assets, not game descriptions or tags.

## Launch Rules

The MVP uses direct executable launches only.

When a matching SWF exists at:

```text
games/<InternalName>/<InternalName>.swf
```

the launch arguments are:

```text
-launchTo games%2F<InternalName>%2F<InternalName>.swf -jbg.config isBundle=false
```

If direct launch support cannot be confirmed, launch the parent pack executable with no mini-game arguments and label the UI action as `Launch Pack Menu`.

The app tracks the spawned PID. `Ctrl+Q` force-closes the tracked process tree using Windows `taskkill`.

## UI Conventions

The UI is a utility launcher, not a marketing page.

Use:

- dark mode by default
- clear operational copy
- large, readable controls suitable for a TV/living-room display
- mouse-first interactions
- keyboard support for common navigation and Escape-to-close dialogs
- Australian/British English spelling in user-facing text

Avoid:

- marketing hero sections
- unnecessary decorative UI
- cards inside cards
- purple/blue gradient-heavy themes
- text that describes the UI itself instead of helping the user act

## Testing Expectations

Add or update tests when changing:

- scanner behaviour
- metadata parsing
- duplicate detection
- launch argument generation
- IPC-facing data shapes
- renderer workflows

Current test areas:

- `tests/metadata.test.ts`
- `tests/scanner.test.ts`
- `tests/App.test.tsx`

Windows can briefly lock test fixture files. Use retrying cleanup for generated fixture directories.

## Generated Files

Do not hand-edit generated output:

- `dist/`
- `release/`
- `node_modules/`
- temporary fixture directories

These should generally not be committed unless the user explicitly asks for built artefacts.

## Packaging Notes

The MVP target is a portable Windows executable.

The build currently disables Windows executable signing/editing:

```json
"signAndEditExecutable": false
```

This avoids local Windows symlink/code-sign helper issues during unsigned MVP packaging. Revisit this when adding a proper icon, signing, or installer workflow.

## Environment Notes

Avoid hardcoding user-specific paths, drive letters, usernames, shell profiles, or installed game locations.

`ELECTRON_RUN_AS_NODE=1` forces Electron to behave like Node and will prevent the GUI from launching. The dev script clears this variable for Electron, but agents should be aware of it when manually running Electron commands.

## Licence And External Code

The project is currently marked `UNLICENSED`.

JackboxUtility may be used as behavioural research only. Do not copy GPL source code, catalogue data, loader assets, or other GPL-covered implementation details into this project unless the user explicitly decides to adopt compatible licensing and attribution.

## Development Style

- Keep changes scoped to the requested behaviour.
- Prefer typed interfaces and structured parsing over ad hoc string manipulation.
- Keep Electron main-process code responsible for filesystem/process work.
- Keep renderer code behind the preload IPC API.
- Avoid exposing raw Node APIs to the renderer.
- Use clear, concise comments only where code needs orientation.
- Preserve user-facing Australian/British English spelling.
