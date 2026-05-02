import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateLibraryArtwork } from "../src/main/artwork";
import type { LibraryState } from "../src/shared/types";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  fixtureRoots.length = 0;
});

describe("artwork hydration", () => {
  it("downloads and caches a SteamGridDB banner for a library game", async () => {
    const cacheDir = await createCacheDir("steamgriddb-success");
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.startsWith("https://www.jackboxgames.com/games/")) {
        return notFoundResponse();
      }
      if (url.includes("/search/autocomplete/Fibbage")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
        return jsonResponse({ success: true, data: [{ id: 123, name: "Fibbage", verified: true }] });
      }
      if (url.includes("/grids/game/123")) {
        expect(url).toContain("dimensions=920x430%2C460x215");
        expect(url).toContain("types=static");
        return jsonResponse({ success: true, data: [{ id: 456, score: 100, url: "https://cdn.example.test/fibbage.png" }] });
      }
      if (url === "https://cdn.example.test/fibbage.png") {
        return new Response(Buffer.from("fake image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Fibbage"),
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl
    });

    const selected = result.library.games[0].selected;
    expect(selected.bannerSource).toBe("steamgriddb");
    expect(selected.bannerUrl).toMatch(/^file:\/\//);
    expect(fileURLToPath(selected.bannerUrl!)).toBe(result.cache["fibbage::fibbage"].localPath);
    expect(result.cache["fibbage::fibbage"]).toMatchObject({
      status: "available",
      displayName: "Fibbage",
      sourceUrl: "https://cdn.example.test/fibbage.png",
      source: "steamgriddb",
      steamGridDbGameId: 123,
      steamGridDbGridId: 456
    });
  });

  it("downloads official Jackbox artwork before trying SteamGridDB", async () => {
    const cacheDir = await createCacheDir("jackbox-official-success");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === "https://www.jackboxgames.com/games/tee-k-o-2") {
        return htmlResponse(`
          <html>
            <head><title>Tee K.O. 2 | Jackbox Games</title></head>
            <body>https://cms-assets.jackboxgames.com/teeko2_tile_0ecff717b2.png</body>
          </html>
        `);
      }
      if (url === "https://cms-assets.jackboxgames.com/teeko2_tile_0ecff717b2.png") {
        return new Response(Buffer.from("fake image"), { headers: { "content-type": "image/png" } });
      }
      if (url.includes("/search/autocomplete/Tee%20K.O.%202")) {
        return jsonResponse({ success: true, data: [{ id: 999, name: "Tee K.O. 2", verified: true }] });
      }
      if (url.includes("/grids/game/999")) {
        return jsonResponse({ success: true, data: [{ id: 998, score: 100, url: "https://cdn.example.test/teeko2_steam.png" }] });
      }
      if (url === "https://cdn.example.test/teeko2_steam.png") {
        return new Response(Buffer.from("different image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Tee K.O. 2"),
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl
    });

    expect(result.library.games[0].selected.bannerUrl).toMatch(/^file:\/\//);
    expect(result.cache["tee-k.o.-2::tee-k.o.-2"]).toMatchObject({
      status: "available",
      source: "jackbox",
      sourceUrl: "https://cms-assets.jackboxgames.com/teeko2_tile_0ecff717b2.png"
    });
  });

  it("selects the requested game's tile from official pages that include sibling pack tiles", async () => {
    const cacheDir = await createCacheDir("jackbox-sibling-tiles");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === "https://www.jackboxgames.com/games/bracketeering") {
        return htmlResponse(`
          <html>
            <head><title>Bracketeering | Jackbox Games</title></head>
            <body>
              https://cms-assets.jackboxgames.com/fibbage_3_tile_2dd7c240cd.png
              https://cms-assets.jackboxgames.com/brack_tile_d3c22d8dd9.png
            </body>
          </html>
        `);
      }
      if (url === "https://cms-assets.jackboxgames.com/brack_tile_d3c22d8dd9.png") {
        return new Response(Buffer.from("fake image"), { headers: { "content-type": "image/png" } });
      }
      if (url === "https://cms-assets.jackboxgames.com/fibbage_3_tile_2dd7c240cd.png") {
        throw new Error("The sibling Fibbage 3 tile should not be downloaded.");
      }
      if (url.includes("/search/autocomplete/Bracketeering")) {
        return jsonResponse({ success: true, data: [{ id: 555, name: "Bracketeering", verified: true }] });
      }
      if (url.includes("/grids/game/555")) {
        return jsonResponse({ success: true, data: [{ id: 556, score: 100, url: "https://cdn.example.test/brack_steam.png" }] });
      }
      if (url === "https://cdn.example.test/brack_steam.png") {
        return new Response(Buffer.from("steam image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Bracketeering"),
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl
    });

    expect(result.cache["bracketeering::bracketeering"]).toMatchObject({
      status: "available",
      source: "jackbox",
      sourceUrl: "https://cms-assets.jackboxgames.com/brack_tile_d3c22d8dd9.png"
    });
  });

  it("does not use inexact SteamGridDB matches for Jackbox mini-games", async () => {
    const cacheDir = await createCacheDir("steamgriddb-inexact");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://www.jackboxgames.com/games/")) {
        return notFoundResponse();
      }
      if (url.includes("/search/autocomplete/Word%20Spud")) {
        return jsonResponse({
          success: true,
          data: [
            { id: 5361255, name: "Word", verified: true },
            { id: 5256260, name: "Word Party", verified: true }
          ]
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Word Spud"),
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl
    });

    expect(result.library.games[0].selected.bannerUrl).toBeUndefined();
    expect(result.cache["word-spud::word-spud"]).toMatchObject({
      status: "missing",
      displayName: "Word Spud",
      cacheVersion: 5
    });
  });

  it("uses generated fallback instead of screenshot art for games without a real tile", async () => {
    const cacheDir = await createCacheDir("jackbox-no-real-tile");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://www.jackboxgames.com/games/")) {
        return notFoundResponse();
      }
      if (url.includes("/search/autocomplete/Quiplash%202")) {
        return jsonResponse({
          success: true,
          data: [
            { id: 5257707, name: "Quiplash 2 InterLASHional", verified: true },
            { id: 6787, name: "Quiplash", verified: true }
          ]
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Quiplash 2"),
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl
    });

    expect(result.library.games[0].selected.bannerUrl).toBeUndefined();
    expect(result.cache["quiplash-2::quiplash-2"]).toMatchObject({ status: "missing" });
  });

  it("can emit renderer-safe custom artwork URLs", async () => {
    const cacheDir = await createCacheDir("steamgriddb-custom-url");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://www.jackboxgames.com/games/")) {
        return notFoundResponse();
      }
      if (url.includes("/search/autocomplete/Quiplash")) {
        return jsonResponse({ success: true, data: [{ id: 321, name: "Quiplash", verified: true }] });
      }
      if (url.includes("/grids/game/321")) {
        return jsonResponse({ success: true, data: [{ id: 654, score: 100, url: "https://cdn.example.test/quiplash.webp" }] });
      }
      if (url === "https://cdn.example.test/quiplash.webp") {
        return new Response(Buffer.from("fake image"), { headers: { "content-type": "image/webp" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Quiplash"),
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl,
      assetUrlForPath: (localPath) => `jackbox-artwork://banners/${path.basename(localPath)}`
    });

    expect(result.library.games[0].selected.bannerUrl).toMatch(/^jackbox-artwork:\/\/banners\/.+\.webp$/);
  });

  it("keeps the CSS fallback when no API key is configured and no official image exists", async () => {
    const cacheDir = await createCacheDir("steamgriddb-no-key");
    const fetchImpl = vi.fn(async () => notFoundResponse());

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Quiplash"),
      apiKey: "",
      cache: {},
      cacheDir,
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.library.games[0].selected.bannerUrl).toBeUndefined();
  });

  it("does not retry a recent missing lookup", async () => {
    const cacheDir = await createCacheDir("steamgriddb-missing");
    const fetchImpl = vi.fn();
    const now = new Date("2026-04-13T00:00:00.000Z");

    const result = await hydrateLibraryArtwork({
      library: createLibrary("No Banner Here"),
      apiKey: "test-key",
      cache: {
        "no-banner-here::no-banner-here": {
          status: "missing",
          displayName: "No Banner Here",
          updatedAt: now.toISOString(),
          cacheVersion: 5
        }
      },
      cacheDir,
      now,
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.library.games[0].selected.bannerUrl).toBeUndefined();
  });

  it("retries old available cache entries after artwork matching changes", async () => {
    const cacheDir = await createCacheDir("steamgriddb-old-cache");
    const oldPath = path.join(cacheDir, "old.png");
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, "old image");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === "https://www.jackboxgames.com/games/word-spud") {
        return htmlResponse(`
          <html>
            <head><title>Word Spud | Jackbox Games</title></head>
            <body>https://cms-assets.jackboxgames.com/wordspud_tile_bcbefd2c72.png</body>
          </html>
        `);
      }
      if (url === "https://cms-assets.jackboxgames.com/wordspud_tile_bcbefd2c72.png") {
        return new Response(Buffer.from("new image"), { headers: { "content-type": "image/png" } });
      }
      if (url.includes("/search/autocomplete/Word%20Spud")) {
        return jsonResponse({ success: true, data: [{ id: 111, name: "Word Spud", verified: true }] });
      }
      if (url.includes("/grids/game/111")) {
        return jsonResponse({ success: true, data: [{ id: 112, score: 100, url: "https://cdn.example.test/wordspud_steam.png" }] });
      }
      if (url === "https://cdn.example.test/wordspud_steam.png") {
        return new Response(Buffer.from("steam image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Word Spud"),
      apiKey: "test-key",
      cache: {
        "word-spud::word-spud": {
          status: "available",
          displayName: "Word Spud",
          updatedAt: "2026-04-13T00:00:00.000Z",
          localPath: oldPath,
          source: "steamgriddb",
          sourceUrl: "https://cdn.example.test/wrong.png"
        }
      },
      cacheDir,
      now: new Date("2026-04-13T00:00:00.000Z"),
      fetchImpl
    });

    expect(result.cache["word-spud::word-spud"]).toMatchObject({
      cacheVersion: 5,
      source: "jackbox",
      sourceUrl: "https://cms-assets.jackboxgames.com/wordspud_tile_bcbefd2c72.png"
    });
  });

  it("does not assign the same source URL to two different games", async () => {
    const cacheDir = await createCacheDir("steamgriddb-unique-urls");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://www.jackboxgames.com/games/fibbage")) {
        return htmlResponse(`
          <html>
            <head><title>Fibbage | Jackbox Games</title></head>
            <body>https://cms-assets.jackboxgames.com/fibbage_tile.png</body>
          </html>
        `);
      }
      if (url.startsWith("https://www.jackboxgames.com/games/quiplash")) {
        return htmlResponse(`
          <html>
            <head><title>Quiplash | Jackbox Games</title></head>
            <body>https://cms-assets.jackboxgames.com/quiplash_tile.png</body>
          </html>
        `);
      }
      if (url === "https://cms-assets.jackboxgames.com/fibbage_tile.png") {
        return new Response(Buffer.from("fibbage image"), { headers: { "content-type": "image/png" } });
      }
      if (url === "https://cms-assets.jackboxgames.com/quiplash_tile.png") {
        return new Response(Buffer.from("quiplash image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const lib = multiGameLibrary(["Fibbage", "Quiplash"]);
    const result = await hydrateLibraryArtwork({
      library: lib,
      apiKey: "",
      cache: {},
      cacheDir,
      fetchImpl
    });

    const fibbageUrl = result.library.games[0].selected.bannerUrl;
    const quiplashUrl = result.library.games[1].selected.bannerUrl;
    expect(fibbageUrl).toBeTruthy();
    expect(quiplashUrl).toBeTruthy();
    expect(fibbageUrl).not.toBe(quiplashUrl);

    const fibbageLocal = result.cache["fibbage::fibbage"].localPath;
    const quiplashLocal = result.cache["quiplash::quiplash"].localPath;
    expect(fibbageLocal).not.toBe(quiplashLocal);

    const fibbageSourceUrl = result.cache["fibbage::fibbage"].sourceUrl;
    const quiplashSourceUrl = result.cache["quiplash::quiplash"].sourceUrl;
    expect(fibbageSourceUrl).not.toBe(quiplashSourceUrl);
  });

  it("does not assign the same SteamGridDB banner to two different games", async () => {
    const cacheDir = await createCacheDir("steamgriddb-unique-grids");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://www.jackboxgames.com/games/")) {
        return notFoundResponse();
      }
      if (url.includes("/search/autocomplete/Fibbage%203")) {
        return jsonResponse({ success: true, data: [{ id: 100, name: "Fibbage 3", verified: true }] });
      }
      if (url.includes("/grids/game/100")) {
        return jsonResponse({ success: true, data: [{ id: 1, score: 100, url: "https://cdn.example.test/fibbage3.png" }] });
      }
      if (url.includes("/search/autocomplete/Fibbage%20XL")) {
        return jsonResponse({ success: true, data: [{ id: 200, name: "Fibbage XL", verified: true }] });
      }
      if (url.includes("/grids/game/200")) {
        return jsonResponse({ success: true, data: [{ id: 2, score: 100, url: "https://cdn.example.test/fibbagexl.png" }] });
      }
      if (url === "https://cdn.example.test/fibbage3.png") {
        return new Response(Buffer.from("fibbage3 image"), { headers: { "content-type": "image/png" } });
      }
      if (url === "https://cdn.example.test/fibbagexl.png") {
        return new Response(Buffer.from("fibbagexl image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const lib = multiGameLibrary(["Fibbage 3", "Fibbage XL"]);
    const result = await hydrateLibraryArtwork({
      library: lib,
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl
    });

    const fibbage3SourceUrl = result.cache["fibbage-3::fibbage-3"].sourceUrl;
    const fibbageXlSourceUrl = result.cache["fibbage-xl::fibbage-xl"].sourceUrl;
    expect(fibbage3SourceUrl).toBeTruthy();
    expect(fibbageXlSourceUrl).toBeTruthy();
    expect(fibbage3SourceUrl).not.toBe(fibbageXlSourceUrl);
  });

  it("rejects SteamGridDB artwork whose source URL suggests a non-English language", async () => {
    const cacheDir = await createCacheDir("steamgriddb-foreign-lang");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://www.jackboxgames.com/games/")) {
        return notFoundResponse();
      }
      if (url.includes("/search/autocomplete/Quiplash")) {
        return jsonResponse({ success: true, data: [{ id: 321, name: "Quiplash", verified: true }] });
      }
      if (url.includes("/grids/game/321")) {
        return jsonResponse({
          success: true,
          data: [
            { id: 1, score: 100, url: "https://cdn.example.test/quiplash_ru.png" },
            { id: 2, score: 90, url: "https://cdn.example.test/quiplash.png" }
          ]
        });
      }
      if (url === "https://cdn.example.test/quiplash_ru.png") {
        return new Response(Buffer.from("russian image"), { headers: { "content-type": "image/png" } });
      }
      if (url === "https://cdn.example.test/quiplash.png") {
        return new Response(Buffer.from("english image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Quiplash"),
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl
    });

    expect(result.cache["quiplash::quiplash"]).toMatchObject({
      status: "available",
      sourceUrl: "https://cdn.example.test/quiplash.png"
    });
  });

  it("rejects Jackbox official artwork whose URL suggests a non-English language", async () => {
    const cacheDir = await createCacheDir("jackbox-official-foreign");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === "https://www.jackboxgames.com/games/fibbage") {
        return htmlResponse(`
          <html>
            <head><title>Fibbage | Jackbox Games</title></head>
            <body>
              https://cms-assets.jackboxgames.com/fibbage_tile_ru.png
              https://cms-assets.jackboxgames.com/fibbage_tile.png
            </body>
          </html>
        `);
      }
      if (url === "https://cms-assets.jackboxgames.com/fibbage_tile_ru.png") {
        return new Response(Buffer.from("russian image"), { headers: { "content-type": "image/png" } });
      }
      if (url === "https://cms-assets.jackboxgames.com/fibbage_tile.png") {
        return new Response(Buffer.from("english image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Fibbage"),
      apiKey: "",
      cache: {},
      cacheDir,
      fetchImpl
    });

    expect(result.cache["fibbage::fibbage"].sourceUrl).toBe("https://cms-assets.jackboxgames.com/fibbage_tile.png");
  });

  it("rejects images without a game-name match on official Jackbox pages", async () => {
    const cacheDir = await createCacheDir("jackbox-name-match");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === "https://www.jackboxgames.com/games/wheel-of-enormous-proportions") {
        return htmlResponse(`
          <html>
            <head><title>The Wheel of Enormous Proportions | Jackbox Games</title></head>
            <body>
              https://cms-assets.jackboxgames.com/job_tile_2dd7c240cd.png
              https://cms-assets.jackboxgames.com/wheel_enormous_tile_d3c22d8dd9.png
            </body>
          </html>
        `);
      }
      if (url === "https://cms-assets.jackboxgames.com/job_tile_2dd7c240cd.png") {
        return new Response(Buffer.from("job job image"), { headers: { "content-type": "image/png" } });
      }
      if (url === "https://cms-assets.jackboxgames.com/wheel_enormous_tile_d3c22d8dd9.png") {
        return new Response(Buffer.from("wheel image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("The Wheel of Enormous Proportions"),
      apiKey: "",
      cache: {},
      cacheDir,
      fetchImpl
    });

    expect(result.cache["the-wheel-of-enormous-proportions::the-wheel-of-enormous-proportions"].sourceUrl).toBe(
      "https://cms-assets.jackboxgames.com/wheel_enormous_tile_d3c22d8dd9.png"
    );
  });

  it("invalidates cached entries with foreign language source URLs on re-hydration", async () => {
    const cacheDir = await createCacheDir("steamgriddb-cached-foreign");
    const cachedPath = path.join(cacheDir, "old-russian.png");
    await mkdir(path.dirname(cachedPath), { recursive: true });
    await writeFile(cachedPath, "old russian image");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === "https://www.jackboxgames.com/games/fibbage-xl") {
        return htmlResponse(`
          <html>
            <head><title>Fibbage XL | Jackbox Games</title></head>
            <body>https://cms-assets.jackboxgames.com/fibbage_xl_tile.png</body>
          </html>
        `);
      }
      if (url === "https://cms-assets.jackboxgames.com/fibbage_xl_tile.png") {
        return new Response(Buffer.from("new english image"), { headers: { "content-type": "image/png" } });
      }
      if (url.includes("/search/autocomplete/Fibbage%20XL")) {
        return jsonResponse({ success: true, data: [{ id: 222, name: "Fibbage XL", verified: true }] });
      }
      if (url.includes("/grids/game/222")) {
        return jsonResponse({ success: true, data: [{ id: 223, score: 100, url: "https://cdn.example.test/fibbagexl_steam.png" }] });
      }
      if (url === "https://cdn.example.test/fibbagexl_steam.png") {
        return new Response(Buffer.from("steam image"), { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const result = await hydrateLibraryArtwork({
      library: createLibrary("Fibbage XL"),
      apiKey: "test-key",
      cache: {
        "fibbage-xl::fibbage-xl": {
          status: "available",
          displayName: "Fibbage XL",
          updatedAt: "2026-04-13T00:00:00.000Z",
          localPath: cachedPath,
          source: "steamgriddb",
          sourceUrl: "https://cdn.example.test/fibbage_xl_ru.png"
        }
      },
      cacheDir,
      now: new Date("2026-04-14T00:00:00.000Z"),
      fetchImpl
    });

    expect(result.cache["fibbage-xl::fibbage-xl"]).toMatchObject({
      status: "available",
      source: "jackbox",
      sourceUrl: "https://cms-assets.jackboxgames.com/fibbage_xl_tile.png"
    });
  });

  it("content-hash deduplication prevents two games from downloading the same image", async () => {
    const cacheDir = await createCacheDir("steamgriddb-content-hash-dup");
    const sameImageBuffer = Buffer.from("shared image content for both games");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://www.jackboxgames.com/games/")) {
        return notFoundResponse();
      }
      if (url.includes("/search/autocomplete/Game%20A")) {
        return jsonResponse({ success: true, data: [{ id: 1, name: "Game A", verified: true }] });
      }
      if (url.includes("/grids/game/1")) {
        return jsonResponse({ success: true, data: [{ id: 10, score: 100, url: "https://cdn.example.test/shared_tile.png" }] });
      }
      if (url.includes("/search/autocomplete/Game%20B")) {
        return jsonResponse({ success: true, data: [{ id: 1, name: "Game A", verified: true }] });
      }
      if (url.includes("/grids/game/1")) {
        return jsonResponse({ success: true, data: [{ id: 10, score: 100, url: "https://cdn.example.test/shared_tile.png" }] });
      }
      if (url === "https://cdn.example.test/shared_tile.png") {
        return new Response(sameImageBuffer, { headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const lib = multiGameLibrary(["Game A", "Game B"]);
    const result = await hydrateLibraryArtwork({
      library: lib,
      apiKey: "test-key",
      cache: {},
      cacheDir,
      fetchImpl
    });

    const gameA = result.library.games[0].selected;
    const gameB = result.library.games[1].selected;
    expect(gameA.bannerUrl).toBeTruthy();
    expect(gameB.bannerUrl).toBeUndefined();
    expect(result.cache["game-a::game-a"].status).toBe("available");
    expect(result.cache["game-b::game-b"].status).toBe("missing");
  });
});

async function createCacheDir(name: string): Promise<string> {
  const root = path.join(process.cwd(), "tmp-test-fixtures", `${name}-${Date.now()}`);
  fixtureRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function htmlResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html" } });
}

function notFoundResponse(): Response {
  return new Response("", { status: 404 });
}

function createLibrary(displayName: string): LibraryState {
  const duplicateKey = `${displayName.toLowerCase().replaceAll(" ", "-")}::${displayName.toLowerCase().replaceAll(" ", "-")}`;
  const selected = {
    installationId: "install-1",
    gameId: duplicateKey,
    duplicateKey,
    packId: "pack-1",
    packName: "The Jackbox Party Pack",
    packPath: "C:\\Games\\Jackbox",
    executablePath: "C:\\Games\\Jackbox\\Jackbox.exe",
    gamesPath: "C:\\Games\\Jackbox\\games",
    internalName: displayName.replaceAll(" ", ""),
    folderPath: `C:\\Games\\Jackbox\\games\\${displayName.replaceAll(" ", "")}`,
    displayName,
    description: "",
    directLaunchSupported: true,
    launchLabel: "Launch Game" as const
  };

  return {
    packs: [],
    games: [
      {
        gameId: duplicateKey,
        duplicateKey,
        selectedInstallationId: selected.installationId,
        hasDuplicateChoices: false,
        needsDuplicateChoice: false,
        installations: [selected],
        selected
      }
    ],
    duplicates: []
  };
}

function multiGameLibrary(displayNames: string[]): LibraryState {
  const games: LibraryState["games"] = [];

  for (const displayName of displayNames) {
    const duplicateKey = `${displayName.toLowerCase().replaceAll(" ", "-")}::${displayName.toLowerCase().replaceAll(" ", "-")}`;
    const selected = {
      installationId: `install-${displayName.replaceAll(" ", "").toLowerCase()}`,
      gameId: duplicateKey,
      duplicateKey,
      packId: "pack-1",
      packName: "The Jackbox Party Pack",
      packPath: "C:\\Games\\Jackbox",
      executablePath: "C:\\Games\\Jackbox\\Jackbox.exe",
      gamesPath: "C:\\Games\\Jackbox\\games",
      internalName: displayName.replaceAll(" ", ""),
      folderPath: `C:\\Games\\Jackbox\\games\\${displayName.replaceAll(" ", "")}`,
      displayName,
      description: "",
      directLaunchSupported: true,
      launchLabel: "Launch Game" as const
    };
    games.push({
      gameId: duplicateKey,
      duplicateKey,
      selectedInstallationId: selected.installationId,
      hasDuplicateChoices: false,
      needsDuplicateChoice: false,
      installations: [selected],
      selected
    });
  }

  return { packs: [], games, duplicates: [] };
}
