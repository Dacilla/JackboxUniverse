import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtworkCacheEntry, BannerSource, GameInstallation, LibraryGame, LibraryState } from "../shared/types.js";
import { normaliseKey, stableHash } from "./hash.js";

const steamGridDbApiBase = "https://www.steamgriddb.com/api/v2";
const jackboxGamesBase = "https://www.jackboxgames.com/games";
const retryAfterMs = 7 * 24 * 60 * 60 * 1000;
const artworkCacheVersion = 5;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface SteamGridDbGame {
  id?: unknown;
  name?: unknown;
  verified?: unknown;
}

interface SteamGridDbGrid {
  id?: unknown;
  score?: unknown;
  url?: unknown;
}

interface SteamGridDbListResponse<T> {
  success?: unknown;
  data?: unknown;
}

interface DownloadedBanner {
  cacheEntry: ArtworkCacheEntry;
}

interface ArtworkCandidate {
  source: BannerSource;
  sourceUrl: string;
  steamGridDbGameId?: number;
  steamGridDbGridId?: number;
}

export interface ArtworkHydrationOptions {
  library: LibraryState;
  apiKey?: string;
  cache: Record<string, ArtworkCacheEntry>;
  cacheDir: string;
  now?: Date;
  fetchImpl?: FetchLike;
  assetUrlForPath?: (localPath: string) => string;
  onProgress?: (current: number, total: number, displayName: string) => void;
}

export async function hydrateLibraryArtwork({
  library,
  apiKey,
  cache,
  cacheDir,
  now = new Date(),
  fetchImpl = fetch,
  assetUrlForPath = (localPath) => pathToFileURL(localPath).href,
  onProgress
}: ArtworkHydrationOptions): Promise<{ library: LibraryState; cache: Record<string, ArtworkCacheEntry> }> {
  const nextCache = { ...cache };
  const token = apiKey?.trim();
  const assignedImageHashes = new Set<string>();

  await fs.mkdir(cacheDir, { recursive: true });

  const pending = library.games.filter((game) => {
    const cached = nextCache[game.duplicateKey];
    if (!cached || cached.displayName !== game.selected.displayName) return true;
    if (cached.cacheVersion !== artworkCacheVersion) return true;
    if (cached.sourceUrl && isForeignLanguageUrl(cached.sourceUrl)) return true;
    if (cached.status === "available" && cached.localPath) return false;
    if (cached.status === "available") return true;
    if (cached.status === "missing" || cached.status === "error") {
      return now.getTime() - Date.parse(cached.updatedAt) >= retryAfterMs;
    }
    return true;
  });

  for (const game of library.games) {
    const cached = nextCache[game.duplicateKey];
    if (cached?.status === "available" && cached?.cacheVersion === artworkCacheVersion && cached?.displayName === game.selected.displayName && cached?.localPath && !isForeignLanguageUrl(cached.sourceUrl ?? "")) {
      try {
        assignedImageHashes.add(createHash("sha256").update(await fs.readFile(cached.localPath)).digest("hex"));
      } catch {
        // ignore
      }
    }
  }

  const batchSize = 8;
  let completed = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (game) => {
        try {
          const downloaded = await downloadBanner({
            displayName: game.selected.displayName,
            duplicateKey: game.duplicateKey,
            apiKey: token,
            cacheDir,
            now,
            fetchImpl,
            assignedImageHashes
          });

          nextCache[game.duplicateKey] =
            downloaded?.cacheEntry ?? {
              status: "missing",
              displayName: game.selected.displayName,
              updatedAt: now.toISOString(),
              cacheVersion: artworkCacheVersion
            };
        } catch (error) {
          nextCache[game.duplicateKey] = {
            status: "error",
            displayName: game.selected.displayName,
            updatedAt: now.toISOString(),
            cacheVersion: artworkCacheVersion,
            errorMessage: error instanceof Error ? error.message : "SteamGridDB request failed."
          };
        } finally {
          completed++;
          onProgress?.(completed, pending.length, game.selected.displayName);
        }
      })
    );
  }

  return { library: applyArtworkCache(library, nextCache, assetUrlForPath), cache: nextCache };
}

export function applyArtworkCache(
  library: LibraryState,
  cache: Record<string, ArtworkCacheEntry>,
  assetUrlForPath: (localPath: string) => string = (localPath) => pathToFileURL(localPath).href
): LibraryState {
  const games = library.games.map((game) => applyArtworkToGame(game, cache[game.duplicateKey], assetUrlForPath));
  const duplicates = library.duplicates.map((duplicate) => ({
    ...duplicate,
    installations: duplicate.installations.map((installation) =>
      applyArtworkToInstallation(installation, cache[duplicate.gameId], assetUrlForPath)
    )
  }));
  return { ...library, games, duplicates };
}

async function shouldUseCachedEntry(entry: ArtworkCacheEntry | undefined, displayName: string, now: Date): Promise<boolean> {
  if (!entry || entry.displayName !== displayName) return false;
  if (entry.cacheVersion !== artworkCacheVersion) return false;
  if (entry.sourceUrl && isForeignLanguageUrl(entry.sourceUrl)) return false;
  if (entry.status === "available") return Boolean(entry.localPath && (await exists(entry.localPath)));
  return now.getTime() - Date.parse(entry.updatedAt) < retryAfterMs;
}

function applyArtworkToGame(
  game: LibraryGame,
  entry: ArtworkCacheEntry | undefined,
  assetUrlForPath: (localPath: string) => string
): LibraryGame {
  return {
    ...game,
    selected: applyArtworkToInstallation(game.selected, entry, assetUrlForPath),
    installations: game.installations.map((installation) => applyArtworkToInstallation(installation, entry, assetUrlForPath))
  };
}

function applyArtworkToInstallation(
  installation: GameInstallation,
  entry: ArtworkCacheEntry | undefined,
  assetUrlForPath: (localPath: string) => string
): GameInstallation {
  if (entry?.status !== "available" || !entry.localPath) {
    const { bannerSource: _bannerSource, bannerUrl: _bannerUrl, ...rest } = installation;
    return rest;
  }

  return {
    ...installation,
    bannerUrl: assetUrlForPath(entry.localPath),
    bannerSource: entry.source ?? "steamgriddb"
  };
}

async function downloadBanner({
  displayName,
  duplicateKey,
  apiKey,
  cacheDir,
  now,
  fetchImpl,
  assignedImageHashes
}: {
  displayName: string;
  duplicateKey: string;
  apiKey?: string;
  cacheDir: string;
  now: Date;
  fetchImpl: FetchLike;
  assignedImageHashes: Set<string>;
}): Promise<DownloadedBanner | undefined> {
  for (const candidate of await findArtworkCandidates(displayName, apiKey, fetchImpl)) {
    if (isForeignLanguageUrl(candidate.sourceUrl)) continue;
    const downloaded = await downloadImage(candidate.sourceUrl, duplicateKey, cacheDir, fetchImpl);
    if (assignedImageHashes.has(downloaded.imageHash)) continue;
    assignedImageHashes.add(downloaded.imageHash);
    return {
      cacheEntry: {
        status: "available",
        displayName,
        updatedAt: now.toISOString(),
        cacheVersion: artworkCacheVersion,
        localPath: downloaded.localPath,
        sourceUrl: candidate.sourceUrl,
        source: candidate.source,
        steamGridDbGameId: candidate.steamGridDbGameId,
        steamGridDbGridId: candidate.steamGridDbGridId
      }
    };
  }

  return undefined;
}

async function findArtworkCandidates(displayName: string, apiKey: string | undefined, fetchImpl: FetchLike): Promise<ArtworkCandidate[]> {
  const candidates: ArtworkCandidate[] = [];

  const jackboxSourceUrl = await findOfficialJackboxImage(displayName, fetchImpl);
  if (jackboxSourceUrl) {
    candidates.push({ source: "jackbox", sourceUrl: jackboxSourceUrl });
  }

  if (!apiKey) return candidates;

  const games = await findSteamGridDbGames(displayName, apiKey, fetchImpl);
  for (const game of games) {
    const grids = await findSteamGridDbGrids(game.id, apiKey, fetchImpl);
    for (const grid of grids) {
      candidates.push({
        source: "steamgriddb",
        sourceUrl: grid.url,
        steamGridDbGameId: game.id,
        steamGridDbGridId: grid.id
      });
    }
  }

  return candidates;
}

async function findOfficialJackboxImage(displayName: string, fetchImpl: FetchLike): Promise<string | undefined> {
  const directImageUrl = jackboxDirectImageUrls[normaliseSearchText(displayName)];
  if (directImageUrl) return directImageUrl;

  for (const slug of candidateJackboxSlugs(displayName)) {
    let response: Response;
    try {
      response = await fetchImpl(`${jackboxGamesBase}/${slug}`, { headers: { Accept: "text/html" } });
    } catch {
      continue;
    }

    if (!response.ok) continue;

    const html = await response.text();
    if (!pageTitleMatchesDisplayName(html, displayName)) continue;

    const imageUrl = extractOfficialJackboxImageUrl(html, displayName);
    if (imageUrl) return imageUrl;
  }

  return undefined;
}

async function findSteamGridDbGames(
  displayName: string,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<Array<{ id: number; name: string }>> {
  const endpoint = `${steamGridDbApiBase}/search/autocomplete/${encodeURIComponent(displayName)}`;
  const response = await fetchSteamGridDbJson<SteamGridDbListResponse<SteamGridDbGame>>(endpoint, apiKey, fetchImpl);
  const games = arrayOfObjects<SteamGridDbGame>(response?.data)
    .map((game) => ({
      id: numberOrUndefined(game.id),
      name: typeof game.name === "string" ? game.name : "",
      verified: game.verified === true
    }))
    .filter((game): game is { id: number; name: string; verified: boolean } => Number.isFinite(game.id) && Boolean(game.name));

  return rankGameCandidates(displayName, games);
}

async function findSteamGridDbGrids(
  gameId: number,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<Array<{ id: number; url: string }>> {
  const endpoint = new URL(`${steamGridDbApiBase}/grids/game/${gameId}`);
  endpoint.searchParams.set("dimensions", "920x430,460x215");
  endpoint.searchParams.set("mimes", "image/png,image/jpeg,image/webp");
  endpoint.searchParams.set("types", "static");
  endpoint.searchParams.set("nsfw", "false");
  endpoint.searchParams.set("humor", "false");
  endpoint.searchParams.set("epilepsy", "false");
  endpoint.searchParams.set("limit", "20");

  const response = await fetchSteamGridDbJson<SteamGridDbListResponse<SteamGridDbGrid>>(endpoint, apiKey, fetchImpl);
  const grids = arrayOfObjects<SteamGridDbGrid>(response?.data)
    .map((grid) => ({
      id: numberOrUndefined(grid.id),
      score: numberOrUndefined(grid.score) ?? 0,
      url: typeof grid.url === "string" ? grid.url : ""
    }))
    .filter((grid): grid is { id: number; score: number; url: string } => Number.isFinite(grid.id) && Boolean(grid.url));

  return grids.sort((a, b) => b.score - a.score);
}

async function fetchSteamGridDbJson<T>(endpoint: string | URL, apiKey: string, fetchImpl: FetchLike): Promise<T | undefined> {
  const response = await fetchImpl(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    }
  });

  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`SteamGridDB returned HTTP ${response.status}.`);
  return (await response.json()) as T;
}

async function downloadImage(
  imageUrl: string,
  duplicateKey: string,
  cacheDir: string,
  fetchImpl: FetchLike
): Promise<{ localPath: string; imageHash: string }> {
  const response = await fetchImpl(imageUrl);
  if (!response.ok) throw new Error(`Artwork image returned HTTP ${response.status}.`);

  const contentType = response.headers.get("content-type") ?? "";
  const extension = extensionForContentType(contentType) ?? extensionFromUrl(imageUrl) ?? ".jpg";
  if (!contentType.toLowerCase().startsWith("image/") && !extensionFromUrl(imageUrl)) {
    throw new Error("Artwork download did not return an image.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const imageHash = createHash("sha256").update(buffer).digest("hex");
  const localPath = path.join(cacheDir, `${stableHash(duplicateKey)}${extension}`);
  await fs.writeFile(localPath, buffer);
  return { localPath, imageHash };
}

function rankGameCandidates(
  displayName: string,
  games: Array<{ id: number; name: string; verified: boolean }>
): Array<{ id: number; name: string }> {
  const target = normaliseSearchText(displayName);
  return games
    .map((game) => ({
      ...game,
      rank: rankGameMatch(target, normaliseSearchText(game.name), game.verified)
    }))
    .filter((game) => game.rank > 0)
    .sort((a, b) => b.rank - a.rank);
}

function rankGameMatch(target: string, candidate: string, verified: boolean): number {
  if (!target || !candidate) return 0;
  const verifiedBoost = verified ? 2 : 0;
  if (compactSearchText(candidate) === compactSearchText(target)) return 100 + verifiedBoost;
  if (candidate === target) return 100 + verifiedBoost;
  return 0;
}

function normaliseSearchText(value: string): string {
  return normaliseKey(value.replace(/[’']/g, ""))
    .replace(/-/g, " ")
    .replace(/\bjackbox\b/g, "")
    .replace(/\bparty\b/g, "")
    .replace(/\bpack\b/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchText(value: string): string {
  return value.replace(/\s+/g, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function candidateJackboxSlugs(displayName: string): string[] {
  const directSlug = slugifyGameName(displayName);
  const aliases = jackboxSlugAliases[normaliseSearchText(displayName)] ?? [];
  return [...new Set([...aliases, directSlug])];
}

function slugifyGameName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function pageTitleMatchesDisplayName(html: string, displayName: string): boolean {
  const title = decodeHtmlEntities(html.match(/<title>(.*?)\s*\|\s*Jackbox Games<\/title>/i)?.[1] ?? "");
  if (!title) return false;
  return compactSearchText(normaliseSearchText(title)) === compactSearchText(normaliseSearchText(displayName));
}

function extractOfficialJackboxImageUrl(html: string, displayName: string): string | undefined {
  const urls = [...html.matchAll(/https:\/\/cms-assets\.jackboxgames\.com\/[^"'<>\s\\]+?\.(?:png|jpe?g|webp)/gi)].map(
    (match) => match[0].replace(/\\u002F/g, "/")
  );

  const ranked = [...new Set(urls)]
    .filter((url) => !isForeignLanguageUrl(url))
    .map((url) => ({ url, score: scoreOfficialImageUrl(url, displayName) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.url;
}

function scoreOfficialImageUrl(url: string, displayName: string): number {
  const pathName = new URL(url).pathname.toLowerCase();
  const fileName = path.basename(pathName).replace(/\.(?:png|jpe?g|webp)$/i, "");
  const canonicalName = normaliseSearchText(displayName);
  const compactName = compactSearchText(canonicalName);
  const aliases = imageNameAliases[canonicalName] ?? [];

  const compactFileName = compactSearchText(fileName.replace(/[_-]/g, " "));
  const nameMatches = compactFileName.includes(compactName);
  const aliasMatches = aliases.some((alias) => pathName.includes(alias));

  if (!nameMatches && !aliasMatches) return 0;

  let score = nameMatches ? 120 : 0;
  for (const alias of aliases) {
    if (pathName.includes(alias)) score = Math.max(score, 140);
  }

  if (/tile/.test(fileName)) score += 60;
  if (/splash|key|announcement/.test(fileName)) score += 25;
  if (/screenshot|mobile|trailer|warmup|round|scene/.test(fileName)) score -= 60;
  if (/wordmark|logo|grab|hero|wide/.test(fileName)) return 0;
  if (/^(large|medium)_/.test(fileName)) score += 5;
  if (/^(small|thumbnail)_/.test(fileName)) score -= 15;

  return score;
}

const jackboxSlugAliases: Record<string, string[]> = {
  fixytext: ["fixy-text"],
  "champd up": ["champd-up", "champd"],
  "quiplash 2 interlashional": ["quiplash-2-interlashional"],
  "you dont know jack full stream": ["ydkj-full-stream"],
  "wheel of enormous proportions": ["wheel-of-enormous-proportions"],
  "job job": ["job-job"],
  "blather round": ["blather-round"],
  "devils and the details": ["devils-and-the-details"],
  "guesspionage": ["guesspionage"],
  "cookie haus": ["cookie-haus", "sus"],
  "fakin it": ["fakin-it"],
  "fakin it all night long": ["fakin-it-all-night-long"],
  "legends of trivia": ["legends-of-trivia"],
  "lie swatter": ["lie-swatter-party", "lie-swatter"],
  "push the button": ["push-the-button", "role"],
  "quiplash 2": ["quiplash-2-interlashional", "quiplash-2"],
  "you dont know jack 2015": ["you-dont-know-jack-2015", "ydkj-2015"],
  "survive the internet": ["survive-the-internet"],
  "dodo re mi": ["dodo-re-mi"],
  "hear say": ["hear-say", "hearsay"],
  "suspectives": ["suspectives"],
  "roomerang": ["roomerang"],
  "doominate": ["doominate"],
  "timejinx": ["time-jinx"],
  "drawful animate": ["drawful-animate"],
  "let me finish": ["let-me-finish"],
  "dirty drawful": ["dirty-drawful"],
  "talking points": ["talking-points"],
  "patently stupid": ["patently-stupid"],
  "tee k o": ["tee-k-o"],
  "tee k o 2": ["tee-k-o-2"],
  "civic doodle": ["civic-doodle"],
  "role models": ["role-models"],
  "rap battle": ["rap-battle"],
  "word spud": ["word-spud"],
  "joke boat": ["joke-boat"],
  "mad verse city": ["mad-verse-city"],
  "split the room": ["split-the-room"],
  "fibbage xl": ["fibbage-xl"],
  "fibbage 2": ["fibbage-2"],
  "fibbage 3": ["fibbage-3"],
  "fibbage 4": ["fibbage-4"],
  "trivia murder party": ["trivia-murder-party"],
  "trivia murder 2": ["trivia-murder-party-2", "tmp2"],
  "bomb corp": ["bomb-corp"],
  "zeeple dome": ["zeeple-dome"],
  "quiplash 3": ["quiplash-3"],
  "nonsensory": ["nonsensory"],
  "weapons drawn": ["weapons-drawn"],
  "bidiots": ["bidiots"],
  "earwax": ["earwax"],
  "monster seeking monster": ["monster-seeking-monster"],
  "junktopia": ["junktopia"],
  "poll mine": ["poll-mine"],
  "bracketeering": ["bracketeering"],
  "hypnotorious": ["hypnotorious"],
  "dictionarium": ["dictionarium"],
  "quiplash xl": ["quiplash-xl"],
  "quixort": ["quixort"],
  "drawful": ["drawful"],
  "fictionary": ["fictionary"],
  "you dont know jack": ["you-dont-know-jack", "ydkj"]
};

const imageNameAliases: Record<string, string[]> = {
  bracketeering: ["brack_tile", "bracket_splash"],
  fixytext: ["fixy_text_tile"],
  hypnotorious: ["hypnotorious_tile"],
  "split room": ["split_tile"],
  "you dont know jack full stream": ["ydkj_full_tile"],
  "patently stupid": ["patent_tile"],
  "zeeple dome": ["zeeple_tile", "zeeple_dome_tile"],
  "trivia murder 2": ["tmp2_tile"],
  "job job": ["job_tile"],
  junktopia: ["junktopia_tile"],
  "quixort": ["quix_tile_a2ef3d0375"],
  "fibbage xl": ["fibbage_xl_tile"],
  "fibbage 3": ["fibbage_3_tile"],
  "champd up": ["champd_tile", "champd_up_tile"],
  "wheel of enormous proportions": ["wheel_television", "wheel_enormous", "wheel_tile"],
  "trivia murder party": ["trivia_tile", "tmp_tile", "trivia_murder"],
  "quiplash": ["quiplash_tile"],
  "fibbage": ["fibbage_tile"],
  "tee k o": ["tee_ko_tile", "teeko_tile"],
  "survive the internet": ["survive_internet_tile", "survive_tile"],
  "mad verse city": ["mad_verse_tile", "madverse_tile"],
  "split the room": ["split_room_tile", "split_tile"],
  "guesspionage": ["guesspionage_tile"],
  "role models": ["role_models_tile"],
  "fakin it": ["fakin_it_tile", "fakin_tile"],
  "civic doodle": ["civic_doodle_tile"],
  "earwax": ["earwax_tile"],
  "monster seeking monster": ["monster_seeking_tile", "msm_tile"],
  "joke boat": ["joke_boat_tile"],
  "lie swatter": ["lie_swatter_tile"],
  "word spud": ["word_spud_tile"],
  "drawful": ["drawful_tile"],
  "blather round": ["blather_round_tile"],
  "devils and the details": ["devils_details_tile"],
  "talking points": ["talking_points_tile"],
  "push the button": ["push_the_button_tile"],
  "dictionarium": ["dictionarium_tile"],
  "rap battle": ["rap_battle_tile"],
  "nonsensory": ["nonsensory_tile"],
  "runway": ["runway_tile"],
  "timejinx": ["timejinx_tile"],
  "poll mine": ["poll_mine_tile"],
  "tee k o 2": ["teeko2_tile"],
  "roomerang": ["roomerang_tile"],
  "dodo re mi": ["dodo_re_mi_tile"],
  "let me finish": ["let_me_finish_tile"],
  "weapons drawn": ["weapons_drawn_tile"],
  "bidiots": ["bidiots_tile"],
  "fictionary": ["fictionary_tile"]
};

const jackboxDirectImageUrls: Record<string, string> = {};

function extensionForContentType(contentType: string): string | undefined {
  const lower = contentType.toLowerCase();
  if (lower.includes("image/png")) return ".png";
  if (lower.includes("image/jpeg")) return ".jpg";
  if (lower.includes("image/webp")) return ".webp";
  return undefined;
}

const foreignLanguageTags = /[_\-( ](?:ru|rus|de|ger|deu|fr|fre|fra|es|spa|ja|jpn|ko|kor|zh|chi|cn|tw|pt|por|br|it|ita|pl|pol|nl|dut|nld|tr|tur|th|tha|vi|vie|ar|ara|he|heb|el|gre|cs|cze|sv|swe|fi|fin|no|nor|da|dan|hu|hun|ro|ron|bg|bul|id|ind|ms|may|uk|ukr)[)_. -]/i;

function isForeignLanguageUrl(url: string): boolean {
  try {
    const pathName = new URL(url).pathname;
    const fileName = pathName.split("/").pop() ?? "";
    return foreignLanguageTags.test(pathName) || foreignLanguageTags.test(fileName);
  } catch {
    return false;
  }
}

function extensionFromUrl(value: string): string | undefined {
  try {
    const extension = path.extname(new URL(value).pathname).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? (extension === ".jpeg" ? ".jpg" : extension) : undefined;
  } catch {
    return undefined;
  }
}

function arrayOfObjects<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as T[]) : [];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
