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

  it("parses jbg.config with commented and empty lines", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `config-comments-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "jbg.config"),
      [
        "# This is a comment",
        "DisplayName=Fibbage",
        "",
        "// Another comment style",
        "MinPlayers=2",
        "MaxPlayers=8"
      ].join("\n")
    );

    const metadata = await extractGameMetadata(root);

    expect(metadata.displayName).toBe("Fibbage");
    expect(metadata.minPlayers).toBe(2);
    expect(metadata.maxPlayers).toBe(8);
  });

  it("parses jbg.config with colon separators", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `config-colon-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "jbg.config"),
      [
        "DisplayName: Quiplash",
        "MinPlayers: 3",
        "MaxPlayers: 8"
      ].join("\n")
    );

    const metadata = await extractGameMetadata(root);

    expect(metadata.displayName).toBe("Quiplash");
    expect(metadata.minPlayers).toBe(3);
    expect(metadata.maxPlayers).toBe(8);
  });

  it("parses jbg.config with quoted values", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `config-quoted-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "jbg.config"),
      [
        'DisplayName="Bidiots"',
        "MaxPlayers='10'",
        "AudienceSupported=false"
      ].join("\n")
    );

    const metadata = await extractGameMetadata(root);

    expect(metadata.displayName).toBe("Bidiots");
    expect(metadata.maxPlayers).toBe(10);
    expect(metadata.audienceSupported).toBe(false);
  });

  it("falls back to folder name when no display name is found", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `fallback-name-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });

    const metadata = await extractGameMetadata(root);

    expect(metadata.displayName).toBe(path.basename(root));
    expect(metadata.description).toBe("");
  });

  it("parses JSON metadata files", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `json-metadata-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({
        displayName: "Fibbage 4",
        description: "The blanking game is back.",
        minPlayers: 2,
        maxPlayers: 8,
        gameType: "trivia",
        audienceSupported: true
      })
    );

    const metadata = await extractGameMetadata(root);

    expect(metadata.displayName).toBe("Fibbage 4");
    expect(metadata.description).toBe("The blanking game is back.");
    expect(metadata.minPlayers).toBe(2);
    expect(metadata.maxPlayers).toBe(8);
    expect(metadata.gameType).toBe("trivia");
    expect(metadata.audienceSupported).toBe(true);
  });

  it("parses XML metadata files", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `xml-metadata-${Date.now()}`);
    fixtureRoots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "game.xml"),
      [
        "<game>",
        "  <name>Quiplash</name>",
        "  <description>Say anything.</description>",
        "  <minPlayers>3</minPlayers>",
        "  <maxPlayers>8</maxPlayers>",
        "</game>"
      ].join("\n")
    );

    const metadata = await extractGameMetadata(root);

    expect(metadata.displayName).toBe("Quiplash");
    expect(metadata.description).toBe("Say anything.");
    expect(metadata.minPlayers).toBe(3);
    expect(metadata.maxPlayers).toBe(8);
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

  it("parses XML files nested up to depth 2", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `nested-xml-${Date.now()}`);
    fixtureRoots.push(root);
    const nested = path.join(root, "config");
    const deeper = path.join(nested, "deeper");
    await mkdir(deeper, { recursive: true });
    await writeFile(path.join(nested, "metadata.xml"), "<root><Title>Tee K.O.</Title></root>");

    const metadata = await extractGameMetadata(root);

    expect(metadata.displayName).toBe("Tee K.O.");
  });

  describe("applyMetadataOverride", () => {
    const base = {
      displayName: "Original",
      description: "Original description.",
      minPlayers: 2,
      maxPlayers: 8,
      gameType: "trivia",
      audienceSupported: true
    };

    it("returns base metadata when no override is given", () => {
      expect(applyMetadataOverride(base, undefined)).toEqual(base);
    });

    it("applies partial overrides while preserving unset fields", () => {
      const result = applyMetadataOverride(base, { gameType: "drawing" });
      expect(result.gameType).toBe("drawing");
      expect(result.displayName).toBe("Original");
      expect(result.minPlayers).toBe(2);
    });

    it("falls back to extracted display name when override is empty string", () => {
      const result = applyMetadataOverride(base, { displayName: "" });
      expect(result.displayName).toBe("Original");
    });

    it("falls back to extracted description when override is empty string", () => {
      const result = applyMetadataOverride(base, { description: "" });
      expect(result.description).toBe("Original description.");
    });

    it("falls back to extracted game type when override is empty string", () => {
      const result = applyMetadataOverride(base, { gameType: "" });
      expect(result.gameType).toBe("trivia");
    });

    it("preserves explicit number overrides of 0", () => {
      const result = applyMetadataOverride(base, { minPlayers: 0, maxPlayers: 0 });
      expect(result.minPlayers).toBe(0);
      expect(result.maxPlayers).toBe(0);
    });

    it("does not override with undefined values", () => {
      const result = applyMetadataOverride(base, { minPlayers: undefined });
      expect(result.minPlayers).toBe(2);
    });

    it("overrides audience supported to false", () => {
      const result = applyMetadataOverride(base, { audienceSupported: false });
      expect(result.audienceSupported).toBe(false);
    });
  });
});
