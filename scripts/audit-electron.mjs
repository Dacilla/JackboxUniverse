import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import electronPath from "electron";

const DEBUG_PORT = 9222;
const WAIT_MS = 12000;

function launchElectron(cwd) {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronPath, [".", `--remote-debugging-port=${DEBUG_PORT}`], {
      cwd,
      env,
      stdio: "ignore",
      windowsHide: false
    });

    child.on("error", reject);
    setTimeout(() => {
      if (child.pid) resolvePromise(child);
      else reject(new Error("Electron failed to start"));
    }, 3000);
  });
}

async function main() {
  console.log("Launching Electron on port", DEBUG_PORT, "...");
  const child = await launchElectron(resolve(process.argv[2] || "."));

  console.log("Waiting", WAIT_MS / 1000, "s for app to load...");
  await new Promise((r) => setTimeout(r, WAIT_MS));

  console.log("Connecting Playwright via CDP...");
  const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
  const contexts = browser.contexts();
  const page = contexts[0]?.pages()[0];

  if (!page) {
    console.log("No page found. Contexts:", contexts.length);
    child.kill();
    process.exit(1);
  }

  console.log("Connected. Title:", await page.title());

  try {
    await page.waitForSelector(".game-tile", { timeout: 30000 });
  } catch {
    console.log("Timed out waiting for tiles. Status:", await page.textContent(".status-strip"));
  }

  const screenshotPath = resolve("artwork-screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log("Screenshot saved to", screenshotPath);

  const tiles = await page.$$eval(".game-tile", (els) =>
    els.map((el) => {
      const h3 = el.querySelector("h3");
      const banner = el.querySelector(".banner");
      const hasArt = banner?.classList.contains("has-artwork") ?? false;
      const img = banner?.querySelector("img");
      const dd = el.querySelectorAll("dd");
      return {
        name: h3?.textContent ?? "",
        hasArtwork: hasArt,
        imgSrc: img?.getAttribute("src")?.slice(-40) ?? "",
        pack: dd[0]?.textContent ?? "",
        players: dd[1]?.textContent ?? ""
      };
    })
  );

  console.log(`\nFound ${tiles.length} games:`);
  const missing = tiles.filter((t) => !t.hasArtwork);
  const has = tiles.filter((t) => t.hasArtwork);
  console.log(`  With artwork: ${has.length}`);
  console.log(`  Missing artwork: ${missing.length}`);
  if (missing.length > 0) {
    console.log("  Missing:");
    missing.forEach((t) => console.log(`    - ${t.name} (${t.pack})`));
  }

  child.kill();
  await browser.close();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
