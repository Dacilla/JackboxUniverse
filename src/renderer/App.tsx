import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { DuplicateGroup, HydrationProgress, LibraryGame, LibraryState, MetadataOverride, Settings } from "../shared/types";

const emptyLibrary: LibraryState = { packs: [], games: [], duplicates: [] };

type SortMode = "pack" | "alpha";

interface Filters {
  search: string;
  playerCount: string;
  gameType: string;
  audience: "all" | "yes" | "no";
  sort: SortMode;
}

const defaultFilters: Filters = {
  search: "",
  playerCount: "",
  gameType: "all",
  audience: "all",
  sort: "pack"
};

export function App(): ReactElement {
  const [library, setLibrary] = useState<LibraryState>(emptyLibrary);
  const [settings, setSettings] = useState<Settings>({ steamGridDbApiKey: "", preferReducedMotion: false });
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading library.");
  const [hydrationProgress, setHydrationProgress] = useState<HydrationProgress | undefined>();
  const [editingGame, setEditingGame] = useState<LibraryGame | undefined>();
  const [showSettings, setShowSettings] = useState(false);
  const [duplicateGroup, setDuplicateGroup] = useState<DuplicateGroup | undefined>();

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setStatus("Loading library.");
    setHydrationProgress(undefined);
    const unsub = window.jackboxUniverse.onProgress((progress) => {
      setHydrationProgress(progress);
      setStatus(`Downloading artwork. ${progress.current} of ${progress.total}`);
    });
    const [nextLibrary, nextSettings] = await Promise.all([
      window.jackboxUniverse.getLibrary(),
      window.jackboxUniverse.getSettings()
    ]);
    unsub();
    setHydrationProgress(undefined);
    setLibrary(nextLibrary);
    setSettings(nextSettings);
    setStatus(statusForLibrary(nextLibrary));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setEditingGame(undefined);
        setDuplicateGroup(undefined);
        setShowSettings(false);
      }
      if (event.target instanceof HTMLElement && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || event.target.tagName === "SELECT" || event.target.isContentEditable)) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") moveFocus(1);
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") moveFocus(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const gameTypes = useMemo(() => {
    const types = new Set<string>();
    for (const game of library.games) {
      if (game.selected.gameType) types.add(game.selected.gameType);
    }
    return [...types].sort((a, b) => a.localeCompare(b));
  }, [library.games]);

  const filteredGames = useMemo(() => {
    const playerCount = Number.parseInt(filters.playerCount, 10);
    const hasPlayerCount = Number.isFinite(playerCount);
    const query = filters.search.trim().toLowerCase();

    return library.games
      .filter((game) => {
        const selected = game.selected;
        const matchesSearch =
          !query ||
          selected.displayName.toLowerCase().includes(query) ||
          selected.packName.toLowerCase().includes(query);
        const matchesPlayers =
          !hasPlayerCount ||
          ((selected.minPlayers ?? 0) <= playerCount &&
            (selected.maxPlayers ?? Number.MAX_SAFE_INTEGER) >= playerCount);
        const matchesType = filters.gameType === "all" || selected.gameType === filters.gameType;
        const matchesAudience =
          filters.audience === "all" ||
          (filters.audience === "yes" && selected.audienceSupported === true) ||
          (filters.audience === "no" && selected.audienceSupported !== true);
        return matchesSearch && matchesPlayers && matchesType && matchesAudience;
      })
      .sort((a, b) => {
        if (filters.sort === "alpha") return a.selected.displayName.localeCompare(b.selected.displayName);
        const packSort = a.selected.packName.localeCompare(b.selected.packName);
        return packSort || a.selected.displayName.localeCompare(b.selected.displayName);
      });
  }, [filters, library.games]);

  const groupedGames = useMemo(() => {
    if (filters.sort === "alpha") return [{ label: "Alphabetical", games: filteredGames }];
    const groups = new Map<string, LibraryGame[]>();
    for (const game of filteredGames) {
      const group = groups.get(game.selected.packName) ?? [];
      group.push(game);
      groups.set(game.selected.packName, group);
    }
    return [...groups.entries()].map(([label, games]) => ({ label, games }));
  }, [filteredGames, filters.sort]);

  async function scanLibrary(): Promise<void> {
    setLoading(true);
    setStatus("Scanning common install folders.");
    setHydrationProgress(undefined);
    const unsub = window.jackboxUniverse.onProgress((progress) => setHydrationProgress(progress));
    const next = await window.jackboxUniverse.scanLibrary();
    unsub();
    setHydrationProgress(undefined);
    setLibrary(next);
    setStatus(statusForLibrary(next));
    setLoading(false);
  }

  async function addManualFolder(): Promise<void> {
    setLoading(true);
    setHydrationProgress(undefined);
    const unsub = window.jackboxUniverse.onProgress((progress) => setHydrationProgress(progress));
    const next = await window.jackboxUniverse.addManualFolder();
    unsub();
    setHydrationProgress(undefined);
    setLibrary(next);
    setStatus(statusForLibrary(next));
    setLoading(false);
  }

  async function launchGame(game: LibraryGame): Promise<void> {
    setStatus(`${game.selected.launchLabel}: ${game.selected.displayName}`);
    const result = await window.jackboxUniverse.launchGame(game.gameId);
    setStatus(result.message);
  }

  async function killActiveGame(): Promise<void> {
    const result = await window.jackboxUniverse.killActiveGame();
    setStatus(result.message);
  }

  async function saveMetadata(gameId: string, override: MetadataOverride): Promise<void> {
    const next = await window.jackboxUniverse.saveMetadataOverride(gameId, override);
    setLibrary(next);
    setEditingGame(undefined);
    setStatus("Custom metadata saved.");
  }

  async function chooseDuplicate(gameId: string, installationId: string): Promise<void> {
    const next = await window.jackboxUniverse.chooseDuplicate(gameId, installationId);
    setLibrary(next);
    setDuplicateGroup(undefined);
    setStatus("Preferred installation saved.");
  }

  async function saveSettings(nextSettings: Settings): Promise<void> {
    setLoading(true);
    setShowSettings(false);
    setHydrationProgress(undefined);
    const saved = await window.jackboxUniverse.saveSettings(nextSettings);
    setSettings(saved);
    const unsub = window.jackboxUniverse.onProgress((progress) => setHydrationProgress(progress));
    const nextLibrary = await window.jackboxUniverse.getLibrary();
    unsub();
    setHydrationProgress(undefined);
    setLibrary(nextLibrary);
    setStatus("Settings saved. Library artwork refreshed.");
    setLoading(false);
  }

  async function clearArtworkCache(): Promise<void> {
    setLoading(true);
    setShowSettings(false);
    setHydrationProgress(undefined);
    const unsub = window.jackboxUniverse.onProgress((progress) => setHydrationProgress(progress));
    const nextLibrary = await window.jackboxUniverse.clearArtworkCache();
    unsub();
    setHydrationProgress(undefined);
    setLibrary(nextLibrary);
    setStatus("Artwork cache cleared. Re-downloading all banners.");
    setLoading(false);
  }

  return (
    <main className={`app-shell${settings.preferReducedMotion ? " reduce-motion" : ""}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Windows launcher</p>
          <h1>Jackbox Universe</h1>
        </div>
        <div className="actions">
          <button type="button" onClick={scanLibrary} disabled={loading}>Scan Library</button>
          <button type="button" onClick={addManualFolder} disabled={loading}>Add Folder</button>
          <button type="button" onClick={killActiveGame}>Close Active Game</button>
          <button type="button" onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>

      <section className="status-strip" aria-live="polite">
        <span>{hydrationProgress ? `Downloading artwork. ${hydrationProgress.current} of ${hydrationProgress.total}` : loading ? "Working..." : status}</span>
        {hydrationProgress ? (
          <progress className="hydration-progress" value={hydrationProgress.current} max={hydrationProgress.total} aria-label="Artwork download progress" />
        ) : null}
        <span>{library.games.length} games</span>
        <span>{library.packs.length} packs</span>
        <span>{library.duplicates.length} duplicate groups</span>
      </section>

      {library.duplicates.some((duplicate) => !duplicate.selectedInstallationId) ? (
        <section className="duplicate-banner">
          <strong>Duplicate installations need a choice.</strong>
          <span>Choose which copy to use before launching those games.</span>
          <button type="button" onClick={() => setDuplicateGroup(library.duplicates.find((item) => !item.selectedInstallationId))}>
            Resolve Duplicates
          </button>
        </section>
      ) : null}

      <FilterBar filters={filters} gameTypes={gameTypes} onChange={setFilters} />

      {library.games.length === 0 ? (
        <section className="empty-state">
          <h2>No games found yet</h2>
          <p>Scan common install folders or add a Jackbox folder manually.</p>
          <div className="actions">
            <button type="button" onClick={scanLibrary} disabled={loading}>Scan Library</button>
            <button type="button" onClick={addManualFolder} disabled={loading}>Add Folder</button>
          </div>
        </section>
      ) : (
        <section className="library" aria-label="Game library">
          {groupedGames.map((group) => (
            <div className="pack-section" key={group.label}>
              <h2>{group.label}</h2>
              <div className="game-grid">
                {group.games.map((game, index) => (
                  <GameTile
                    game={game}
                    index={index}
                    key={game.gameId}
                    onEdit={() => setEditingGame(game)}
                    onLaunch={() => launchGame(game)}
                    onResolveDuplicate={() => setDuplicateGroup(library.duplicates.find((item) => item.gameId === game.gameId))}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {editingGame ? <MetadataDialog game={editingGame} onCancel={() => setEditingGame(undefined)} onSave={saveMetadata} /> : null}
      {duplicateGroup ? <DuplicateDialog group={duplicateGroup} onCancel={() => setDuplicateGroup(undefined)} onChoose={chooseDuplicate} /> : null}
      {showSettings ? <SettingsDialog settings={settings} onCancel={() => setShowSettings(false)} onSave={saveSettings} onClearArtworkCache={clearArtworkCache} /> : null}
    </main>
  );
}

function FilterBar({ filters, gameTypes, onChange }: { filters: Filters; gameTypes: string[]; onChange(filters: Filters): void }): ReactElement {
  return (
    <section className="filters" aria-label="Library filters">
      <label>Search<input value={filters.search} onChange={(event) => onChange({ ...filters, search: event.target.value })} placeholder="Game or pack" /></label>
      <label>Players<input min="1" type="number" value={filters.playerCount} onChange={(event) => onChange({ ...filters, playerCount: event.target.value })} placeholder="Any" /></label>
      <label>Type<select value={filters.gameType} onChange={(event) => onChange({ ...filters, gameType: event.target.value })}><option value="all">All types</option>{gameTypes.map((type) => <option value={type} key={type}>{type}</option>)}</select></label>
      <label>Audience<select value={filters.audience} onChange={(event) => onChange({ ...filters, audience: event.target.value as Filters["audience"] })}><option value="all">Any</option><option value="yes">Supported</option><option value="no">Not supported</option></select></label>
      <label>Sort<select value={filters.sort} onChange={(event) => onChange({ ...filters, sort: event.target.value as SortMode })}><option value="pack">Party Pack</option><option value="alpha">Alphabetical</option></select></label>
    </section>
  );
}

function GameTile({ game, index, onEdit, onLaunch, onResolveDuplicate }: { game: LibraryGame; index: number; onEdit(): void; onLaunch(): void; onResolveDuplicate(): void }): ReactElement {
  const selected = game.selected;
  const playerText = selected.minPlayers && selected.maxPlayers ? `${selected.minPlayers}-${selected.maxPlayers} players` : "Players unknown";
  return (
    <article className="game-tile" onContextMenu={(event) => { event.preventDefault(); onEdit(); }}>
      <button type="button" className={`banner ${selected.bannerUrl ? "has-artwork" : ""}`} data-game-index={index} onClick={onLaunch} style={{ "--banner-accent": colourFor(selected.displayName) } as CSSProperties}>
        {selected.bannerUrl ? <img src={selected.bannerUrl} alt="" aria-hidden="true" loading="lazy" /> : null}
        <span>{selected.displayName}</span>
      </button>
      <div className="game-copy">
        <div>
          <h3>{selected.displayName}</h3>
          <p>{selected.description || "No local description was found."}</p>
        </div>
        <dl>
          <div><dt>Pack</dt><dd>{selected.packName}</dd></div>
          <div><dt>Players</dt><dd>{playerText}</dd></div>
          <div><dt>Audience</dt><dd>{selected.audienceSupported ? "Supported" : "Unknown"}</dd></div>
        </dl>
        <div className="tile-actions">
          <button type="button" onClick={onLaunch}>{selected.launchLabel}</button>
          <button type="button" onClick={onEdit}>Customise</button>
          {game.hasDuplicateChoices ? <button type="button" onClick={onResolveDuplicate}>Duplicates</button> : null}
        </div>
      </div>
    </article>
  );
}

function MetadataDialog({ game, onCancel, onSave }: { game: LibraryGame; onCancel(): void; onSave(gameId: string, override: MetadataOverride): void }): ReactElement {
  const selected = game.selected;
  const [form, setForm] = useState<MetadataOverride>({
    displayName: selected.displayName,
    description: selected.description,
    minPlayers: selected.minPlayers,
    maxPlayers: selected.maxPlayers,
    gameType: selected.gameType,
    audienceSupported: selected.audienceSupported
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="metadata-title">
        <h2 id="metadata-title">Customise Metadata</h2>
        <label>Display name<input value={form.displayName ?? ""} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
        <label>Description<textarea value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <div className="split-fields">
          <label>Min players<input type="number" value={form.minPlayers ?? ""} onChange={(event) => setForm({ ...form, minPlayers: numberOrUndefined(event.target.value) })} /></label>
          <label>Max players<input type="number" value={form.maxPlayers ?? ""} onChange={(event) => setForm({ ...form, maxPlayers: numberOrUndefined(event.target.value) })} /></label>
        </div>
        <label>Game type<input value={form.gameType ?? ""} onChange={(event) => setForm({ ...form, gameType: event.target.value })} /></label>
        <label className="checkbox-row"><input type="checkbox" checked={form.audienceSupported ?? false} onChange={(event) => setForm({ ...form, audienceSupported: event.target.checked })} />Audience supported</label>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={() => onSave(game.gameId, form)}>Save</button>
        </div>
      </section>
    </div>
  );
}

function DuplicateDialog({ group, onCancel, onChoose }: { group: DuplicateGroup; onCancel(): void; onChoose(gameId: string, installationId: string): void }): ReactElement {
  const [selected, setSelected] = useState(group.selectedInstallationId ?? group.installations[0]?.installationId);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-title">
        <h2 id="duplicate-title">Choose Installation</h2>
        <p>{group.displayName} appears in more than one folder.</p>
        <div className="choice-list">
          {group.installations.map((installation) => (
            <label className="choice-row" key={installation.installationId}>
              <input type="radio" name="installation" checked={selected === installation.installationId} onChange={() => setSelected(installation.installationId)} />
              <span><strong>{installation.packName}</strong>{installation.packPath}</span>
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={() => selected && onChoose(group.gameId, selected)}>Use This Copy</button>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({ settings, onCancel, onSave, onClearArtworkCache }: { settings: Settings; onCancel(): void; onSave(settings: Settings): void; onClearArtworkCache(): void }): ReactElement {
  const [form, setForm] = useState(settings);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">Settings</h2>
        <label>SteamGridDB API key<input type="password" value={form.steamGridDbApiKey ?? ""} onChange={(event) => setForm({ ...form, steamGridDbApiKey: event.target.value })} placeholder="Downloads grid banners into local cache" /></label>
        <label className="checkbox-row"><input type="checkbox" checked={form.preferReducedMotion} onChange={(event) => setForm({ ...form, preferReducedMotion: event.target.checked })} />Reduce motion</label>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={() => onSave(form)}>Save</button>
        </div>
        <hr />
        <button type="button" className="danger-button" onClick={onClearArtworkCache}>Clear Artwork Cache &amp; Re-download</button>
      </section>
    </div>
  );
}

function moveFocus(delta: number): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-game-index]")];
  if (buttons.length === 0) return;
  const currentIndex = buttons.findIndex((button) => button === document.activeElement);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function colourFor(seed: string): string {
  const colours = ["#3fbf9b", "#e8c547", "#ef6f6c", "#7bd389", "#f08a4b", "#5db7de"];
  return colours[[...seed].reduce((total, char) => total + char.charCodeAt(0), 0) % colours.length];
}

function statusForLibrary(library: LibraryState): string {
  if (library.games.length === 0) return "No games found. Scan or add a folder to begin.";
  if (library.duplicates.some((duplicate) => !duplicate.selectedInstallationId)) {
    return "Library loaded with duplicate choices to resolve.";
  }
  return "Library ready.";
}
