import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { JackboxUniverseApi, LibraryState } from "../src/shared/types";

const library: LibraryState = {
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
    }
  ],
  duplicates: []
};

describe("App", () => {
  beforeEach(() => {
    const api: JackboxUniverseApi = {
      getLibrary: vi.fn().mockResolvedValue(library),
      scanLibrary: vi.fn().mockResolvedValue(library),
      addManualFolder: vi.fn().mockResolvedValue(library),
      saveMetadataOverride: vi.fn().mockResolvedValue(library),
      chooseDuplicate: vi.fn().mockResolvedValue(library),
      launchGame: vi.fn().mockResolvedValue({ ok: true, message: "Launching game." }),
      killActiveGame: vi.fn().mockResolvedValue({ ok: false, message: "No active Jackbox process is being tracked." }),
      getSettings: vi.fn().mockResolvedValue({ steamGridDbApiKey: "", preferReducedMotion: false }),
      saveSettings: vi.fn().mockImplementation(async (settings) => settings)
    };
    window.jackboxUniverse = api;
  });

  it("renders the library and launch label", async () => {
    render(<App />);

    expect((await screen.findAllByText("Fibbage")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Launch Game").length).toBeGreaterThan(0);
  });

  it("opens metadata editing from the Customise action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Customise"));

    expect(screen.getByRole("dialog", { name: "Customise Metadata" })).toBeInTheDocument();
  });
});
