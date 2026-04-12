# Project: Jackbox Universe
## AI Developer Instructions & Design Document

### 1. Project Overview
Build a store-agnostic, standalone Windows desktop application named **Jackbox Universe** that aggregates individual Jackbox Party Pack mini-games into a single, unified "10-foot UI" launcher. The app must bypass standard pack menus, launching users directly into the selected mini-game.

**Tech Stack:**
* **Framework:** Electron (Node.js backend, HTML/CSS/JS frontend)
* **Styling:** Modern CSS (Grid/Flexbox) suitable for large displays/TVs.
* **Storage:** Local JSON caching (e.g., `electron-store`).

---

### 2. File Scanning & Discovery Logic
The application must find Jackbox installations regardless of the storefront (Steam, Epic, DRM-free) via a hybrid approach.

* **Auto-Scanner (Fast Pass):** Implement a Node.js recursive directory walker. To optimize for speed on NVMe drives, search specifically for executable files containing "Jackbox" in the title, and then check for the adjacent `games` directory. Once found, stop traversing that specific branch.
* **Manual Fallback:** Provide a UI button utilizing Electron's `dialog.showOpenDialog` (configured for folder selection) allowing the user to manually point the app to missing or standalone DRM-free Jackbox folders.
* **Duplicate Handling:** The app must not interface with storefront databases. If the scanner detects two installed copies of the exact same mini-game (e.g., from different root directories), trigger a UI warning prompting the user to select which installation path they prefer to use.
* **Caching & Validation:** Save all discovered base paths to a local cache file. **Crucially**, on every application launch, the app must silently validate that these cached paths still exist. If a path is invalid, remove it from the cache.

---

### 3. Metadata Extraction (The "Plan A" for Data)
Do NOT use external APIs (like IGDB) for text metadata, as they lack individual mini-game entries. All text data must be extracted locally.

* **Folder Parsing:** Iterate through the subdirectories inside the discovered `games` folders.
* **Data Target:** Locate the configuration files within each mini-game folder (varies by engine era: `jbg.config`, `manifest.json`, or `.xml`).
* **Fields to Extract:** Parse these plaintext files to extract the `DisplayName` (e.g., "Tee K.O.", NOT the internal folder name "AwShirt"), `Description`, `MinPlayers`, `MaxPlayers`, and if available, `GameType` and `AudienceSupported`.
* **Manual Metadata Editing:** If older packs lack explicit tags (like `GameType` or `AudienceSupported`), the UI must provide a context menu (e.g., right-click) for a game, allowing the user to manually add, edit, or override these tags so filters continue functioning correctly.

---

### 4. Asset Management (Banners & Logos)
Local files rarely contain high-quality 16:9 banners. 

* **External API (SteamGridDB):** Use the locally extracted `DisplayName` to query the SteamGridDB API for custom grid banners. Download and save the best match to a local appdata folder, linking it in the central cache.
* **API Key Management:** Do NOT hardcode the SteamGridDB API key. Build a "Settings" page in the UI where the user can input and save their personal API key to `electron-store`.
* **Fallback Art:** If the SteamGridDB API returns 0 results or fails, dynamically generate a CSS-based fallback banner. This should consist of a clean, dark background with the extracted `DisplayName` centered using a high-quality, readable font.

---

### 5. Process Execution & State Management
Launching the games requires specific command-line arguments and careful process tracking.

* **CLI Arguments:** Research and reference the open-source **"JackboxUtility"** repository to determine the correct command-line flags required to launch specific mini-games and skip intros. Implement conditional logic (switch/if-else) to apply different arguments based on the Pack version or executable engine type.
* **Process Tracking:** Use Node's `child_process.spawn` or `execFile` to launch the game, and store its PID (Process ID). The launcher window must automatically minimise to the taskbar/system tray upon a successful game launch to stay out of the way.
* **The "Exit Problem":** When a user exits a mini-game, the engine may dump them to the parent Party Pack main menu. Implement a global hotkey (e.g., `Ctrl+Q` or a specific gamepad combo using `globalShortcut` in Electron) that forcefully kills the tracked PID and brings the launcher window back into focus.

---

### 6. UI / UX Requirements
The interface must be designed for a living room environment ("10-foot UI") but remain fully accessible and comfortable for mouse control. All UI text elements must use Australian/British English spelling conventions (e.g., "Minimise", "Customise", "Colour").

* **Window State:** The launcher must open in standard windowed mode (not forced fullscreen).
* **Visuals & Audio:** Dark mode default. Use a CSS Grid layout for game banners. Implement subtle hover states (e.g., scale up, drop shadow, glassmorphism info overlays showing player counts and descriptions on focus/hover). Include minor, unobtrusive audio cues (e.g., soft, low-volume clicks/pops) on hover and selection.
* **Filtering & Sorting:** Implement robust UI controls to sort and filter the library.
    * *Default Sort:* Grouped by Party Pack.
    * *Alternative Sorts/Filters:* Allow filtering by Player Count (Min/Max sliders or dropdowns), Game Type (e.g., drawing, trivia), and Audience Support. Sorting should be changeable (e.g., alphabetical).
* **Navigation:** The interface should support fluid, intuitive mouse input as the primary control method, alongside secondary Keyboard (Arrow keys, Enter, Esc) navigation.
* **Gamepad Support:** Implement the standard HTML5 `Gamepad API` to map controller D-Pad/Thumbstick inputs to the UI navigation logic, allowing users to browse and launch games with an Xbox/PlayStation controller if desired.