import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { JackboxUniverseApi, LibraryState } from "../src/shared/types";

function buildLibrary(overrides: Partial<LibraryState> = {}): LibraryState {
  return {
    packs: [
      {
        packId: "pack-1",
        packName: "The Jackbox Party Pack",
        packPath: "C:\\Games\\Jackbox",
        executablePath: "C:\\Games\\Jackbox\\Jackbox.exe",
        gamesPath: "C:\\Games\\Jackbox\\games"
      }
    ],
    games: [
      {
        gameId: "fibbage::fibbage",
        duplicateKey: "fibbage::fibbage",
        selectedInstallationId: "install-1",
        hasDuplicateChoices: false,
        needsDuplicateChoice: false,
        installations: [],
        selected: {
          installationId: "install-1",
          gameId: "fibbage::fibbage",
          duplicateKey: "fibbage::fibbage",
          packId: "pack-1",
          packName: "The Jackbox Party Pack",
          packPath: "C:\\Games\\Jackbox",
          executablePath: "C:\\Games\\Jackbox\\Jackbox.exe",
          gamesPath: "C:\\Games\\Jackbox\\games",
          internalName: "Fibbage",
          folderPath: "C:\\Games\\Jackbox\\games\\Fibbage",
          displayName: "Fibbage",
          description: "Lie well.",
          minPlayers: 2,
          maxPlayers: 8,
          gameType: "trivia",
          audienceSupported: true,
          directLaunchSupported: true,
          launchLabel: "Launch Game"
        }
      },
      {
        gameId: "quiplash::quiplash",
        duplicateKey: "quiplash::quiplash",
        selectedInstallationId: "install-2",
        hasDuplicateChoices: false,
        needsDuplicateChoice: false,
        installations: [],
        selected: {
          installationId: "install-2",
          gameId: "quiplash::quiplash",
          duplicateKey: "quiplash::quiplash",
          packId: "pack-1",
          packName: "The Jackbox Party Pack 2",
          packPath: "C:\\Games\\Jackbox2",
          executablePath: "C:\\Games\\Jackbox2\\Jackbox.exe",
          gamesPath: "C:\\Games\\Jackbox2\\games",
          internalName: "Quiplash",
          folderPath: "C:\\Games\\Jackbox2\\games\\Quiplash",
          displayName: "Quiplash",
          description: "Say anything.",
          minPlayers: 3,
          maxPlayers: 8,
          gameType: "drawing",
          audienceSupported: false,
          directLaunchSupported: true,
          launchLabel: "Launch Game"
        }
      }
    ],
    duplicates: [],
    ...overrides
  };
}

describe("App", () => {
  beforeEach(() => {
    const api: JackboxUniverseApi = {
      getLibrary: vi.fn().mockResolvedValue(buildLibrary()),
      scanLibrary: vi.fn().mockResolvedValue(buildLibrary()),
      addManualFolder: vi.fn().mockResolvedValue(buildLibrary()),
      saveMetadataOverride: vi.fn().mockResolvedValue(buildLibrary()),
      chooseDuplicate: vi.fn().mockResolvedValue(buildLibrary()),
      launchGame: vi.fn().mockResolvedValue({ ok: true, message: "Launching game." }),
      killActiveGame: vi.fn().mockResolvedValue({ ok: false, message: "No active Jackbox process is being tracked." }),
      getSettings: vi.fn().mockResolvedValue({ steamGridDbApiKey: "", preferReducedMotion: false }),
      saveSettings: vi.fn().mockImplementation(async (settings) => settings),
      onProgress: vi.fn(() => vi.fn()),
      clearArtworkCache: vi.fn().mockResolvedValue(buildLibrary())
    };
    window.jackboxUniverse = api;
  });

  it("renders the library and launch label", async () => {
    render(<App />);

    expect((await screen.findAllByText("Fibbage")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Launch Game").length).toBeGreaterThan(0);
  });

  it("hides generated banner text when artwork is available", async () => {
    const artworkLibrary = buildLibrary();
    artworkLibrary.games[0].selected.bannerUrl = "jackbox-artwork://banners/fibbage.png";
    artworkLibrary.games[0].selected.bannerSource = "jackbox";
    window.jackboxUniverse.getLibrary = vi.fn().mockResolvedValue(artworkLibrary);
    render(<App />);

    const banner = await screen.findByRole("button", { name: "Fibbage" });

    expect(banner).toHaveClass("has-artwork");
  });

  it("opens metadata editing from the Customise action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click((await screen.findAllByText("Customise"))[0]);

    expect(screen.getByRole("dialog", { name: "Customise Metadata" })).toBeInTheDocument();
  });

  it("shows empty state when no games are available", async () => {
    window.jackboxUniverse.getLibrary = vi.fn().mockResolvedValue(buildLibrary({ games: [], packs: [] }));
    render(<App />);

    expect(await screen.findByText("No games found yet")).toBeInTheDocument();
    expect(screen.getAllByText("Scan Library").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Add Folder").length).toBeGreaterThan(0);
  });

  it("filters games by search text", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    const search = screen.getByPlaceholderText("Game or pack");
    await user.type(search, "Quiplash");

    await waitFor(() => {
      expect(screen.queryByText("Fibbage", { selector: "h3" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("Quiplash", { selector: "h3" })).toBeInTheDocument();
  });

  it("filters games by player count", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    const players = screen.getByPlaceholderText("Any");
    await user.type(players, "2");

    await waitFor(() => {
      expect(screen.getByText("Fibbage", { selector: "h3" })).toBeInTheDocument();
      expect(screen.queryByText("Quiplash", { selector: "h3" })).not.toBeInTheDocument();
    });
  });

  it("filters games by game type", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    const typeSelect = screen.getByDisplayValue("All types");
    await user.selectOptions(typeSelect, "trivia");

    await waitFor(() => {
      expect(screen.getByText("Fibbage", { selector: "h3" })).toBeInTheDocument();
      expect(screen.queryByText("Quiplash", { selector: "h3" })).not.toBeInTheDocument();
    });
  });

  it("filters games by audience support", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    const audienceSelect = screen.getByDisplayValue("Any");
    await user.selectOptions(audienceSelect, "Supported");

    await waitFor(() => {
      expect(screen.getByText("Fibbage", { selector: "h3" })).toBeInTheDocument();
      expect(screen.queryByText("Quiplash", { selector: "h3" })).not.toBeInTheDocument();
    });
  });

  it("filters games without audience support", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    const audienceSelect = screen.getByDisplayValue("Any");
    await user.selectOptions(audienceSelect, "Not supported");

    await waitFor(() => {
      expect(screen.queryByText("Fibbage", { selector: "h3" })).not.toBeInTheDocument();
      expect(screen.getByText("Quiplash", { selector: "h3" })).toBeInTheDocument();
    });
  });

  it("switches between pack and alphabetical sort", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    const sortSelect = screen.getByDisplayValue("Party Pack");
    await user.selectOptions(sortSelect, "Alphabetical");

    expect(screen.getByText("Alphabetical", { selector: "h2" })).toBeInTheDocument();
  });

  it("shows duplicate warning banner when duplicates need choice", async () => {
    const dupLib = buildLibrary({
      duplicates: [{
        gameId: "fibbage::fibbage",
        displayName: "Fibbage",
        installations: [buildLibrary().games[0].selected]
      }]
    });
    dupLib.games[0].needsDuplicateChoice = true;
    dupLib.games[0].hasDuplicateChoices = true;
    window.jackboxUniverse.getLibrary = vi.fn().mockResolvedValue(dupLib);
    render(<App />);

    expect(await screen.findByText("Duplicate installations need a choice.")).toBeInTheDocument();
  });

  it("opens settings dialog", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    await user.click(screen.getByText("Settings"));

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Downloads grid banners into local cache")).toBeInTheDocument();
  });

  it("closes dialogs on Escape key", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    await user.click(screen.getAllByText("Customise")[0]);
    expect(screen.getByRole("dialog", { name: "Customise Metadata" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("does not move game focus when arrow keys are pressed inside an input", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));

    const search = screen.getByPlaceholderText("Game or pack");
    search.focus();

    fireEvent.keyDown(search, { key: "ArrowLeft" });
    fireEvent.keyDown(search, { key: "ArrowRight" });

    expect(document.activeElement).toBe(search);
  });

  it("renders status strip with game and pack counts", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));
    expect(screen.getByText("2 games")).toBeInTheDocument();
    expect(screen.getByText("1 packs")).toBeInTheDocument();
  });

  it("renders game type options from library", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getAllByText("Fibbage").length).toBeGreaterThan(0));
    expect(screen.getByText("drawing")).toBeInTheDocument();
    expect(screen.getByText("trivia")).toBeInTheDocument();
  });
});
