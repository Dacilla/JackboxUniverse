import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLibrary, discoverPackRoots, getLaunchArguments, validatePackPaths } from "../src/main/scanner";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  fixtureRoots.length = 0;
});

async function createPack(root: string, packName: string, gameName: string, withSwf = true): Promise<string> {
  const packPath = path.join(root, packName);
  const gamePath = path.join(packPath, "games", gameName);
  await mkdir(gamePath, { recursive: true });
  await writeFile(path.join(packPath, "The Jackbox Party Pack.exe"), "");
  await writeFile(path.join(gamePath, "jbg.config"), `DisplayName=${gameName}\nMinPlayers=2\nMaxPlayers=8`);
  if (withSwf) {
    await writeFile(path.join(gamePath, `${gameName}.swf`), "");
  }
  return packPath;
}

describe("scanner", () => {
  it("discovers pack roots and stops at the pack branch", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `scan-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 3", "AwShirt");
    await mkdir(path.join(packPath, "nested", "games"), { recursive: true });

    const discovered = await discoverPackRoots([root], 5);

    expect(discovered).toEqual([packPath]);
  });

  it("validates cached pack paths", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `validate-${Date.now()}`);
    fixtureRoots.push(root);
    const packPath = await createPack(root, "The Jackbox Party Pack 4", "Fibbage");

    await expect(validatePackPaths([packPath, path.join(root, "missing")])).resolves.toEqual([packPath]);
  });

  it("builds duplicate groups and launch arguments", async () => {
    const root = path.join(process.cwd(), "tmp-test-fixtures", `dupes-${Date.now()}`);
    fixtureRoots.push(root);
    const first = await createPack(root, "Steam Copy", "TriviaMurderParty");
    const second = await createPack(root, "DRM Free Copy", "TriviaMurderParty");

    const library = await buildLibrary([first, second], {}, {}, undefined);
    const duplicate = library.duplicates[0];

    expect(duplicate.installations).toHaveLength(2);
    expect(library.games[0].needsDuplicateChoice).toBe(true);
    expect(getLaunchArguments(library.games[0].selected)).toEqual([
      "-launchTo",
      "games%2FTriviaMurderParty%2FTriviaMurderParty.swf",
      "-jbg.config",
      "isBundle=false"
    ]);
  });
});
