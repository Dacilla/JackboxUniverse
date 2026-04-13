import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMetadataOverride, extractGameMetadata } from "../src/main/metadata";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  fixtureRoots.length = 0;
});

describe("metadata extraction", () => {
  it("parses jbg.config key value metadata", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `config-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "jbg.config"),
      [
        "DisplayName=Tee K.O.",
        "Description=Draw shirts and vote.",
        "MinPlayers=3",
        "MaxPlayers=8",
        "GameType=drawing",
        "AudienceSupported=true"
      ].join("\n")
    );

    const metadata = await extractGameMetadata(root);

    expect(metadata).toEqual({
      displayName: "Tee K.O.",
      description: "Draw shirts and vote.",
      minPlayers: 3,
      maxPlayers: 8,
      gameType: "drawing",
      audienceSupported: true
    });
  });

  it("parses JSON jbg.config.jet metadata without treating nested content manifests as game titles", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `jet-config-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(path.join(root, "content"), { recursive: true });
    await writeFile(path.join(root, "jbg.config.jet"), JSON.stringify({ gameName: "TimeTrivia", gameTag: "time-trivia" }));
    await writeFile(path.join(root, "content", "manifest.json"), JSON.stringify({ title: "Main Content Pack" }));

    const metadata = await extractGameMetadata(root);

    expect(metadata.displayName).toBe("TimeTrivia");
  });

  it("applies manual overrides after extracted metadata", () => {
    const metadata = applyMetadataOverride(
      {
        displayName: "Internal",
        description: "",
        minPlayers: 2,
        maxPlayers: 4
      },
      {
        displayName: "Custom Name",
        gameType: "trivia",
        audienceSupported: false
      }
    );

    expect(metadata.displayName).toBe("Custom Name");
    expect(metadata.minPlayers).toBe(2);
    expect(metadata.gameType).toBe("trivia");
    expect(metadata.audienceSupported).toBe(false);
  });
});
