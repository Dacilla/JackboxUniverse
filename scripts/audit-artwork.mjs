import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const configPath = join(process.env.APPDATA || "", "jackbox-universe", "jackbox-universe.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const cache = config.artworkCache || {};
const cacheDir = join(process.env.APPDATA || "", "jackbox-universe", "steamgriddb-banners");

const items = Object.entries(cache)
  .filter(([, e]) => e.status === "available" && e.localPath)
  .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName));

const missing = Object.values(cache).filter((e) => e.status === "missing").length;

const tiles = items
  .map(([key, entry]) => {
    const fname = basename(entry.localPath);
    const src = "file:///" + entry.localPath.replace(/\\/g, "/");
    const sourceLabel =
      entry.source === "jackbox" ? "Jackbox" : entry.source === "steamgriddb" ? "SteamGridDB" : entry.source || "?";
    const hue = Math.abs(key.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % 360);
    return `<div class="tile">
      <div class="banner" style="--accent:hsl(${hue},60%,45%)">
        <img src="${src}" onerror="this.parentElement.classList.add('broken')" loading="lazy" />
        <span>${entry.displayName}</span>
      </div>
      <div class="info">
        <strong>${entry.displayName}</strong>
        <small>${sourceLabel}</small>
      </div>
    </div>`;
  })
  .join("");

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Artwork Audit</title>
<style>
body{background:#111;color:#eee;font:16px/1.4 system-ui;margin:24px}
h1{font-size:1.4em;margin-bottom:4px}
h2{margin-top:0;color:#888;font-weight:400;font-size:1em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}
.tile{display:grid;gap:8px}
.banner{position:relative;aspect-ratio:16/9;overflow:hidden;background:linear-gradient(160deg,var(--accent),#171717 62%);display:grid;place-items:center}
.banner img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.banner.broken img{display:none}
.banner span{position:relative;z-index:1;font-weight:800;font-size:1.8em;text-align:center;color:#fff;max-width:86%;text-shadow:0 2px 12px rgba(0,0,0,0.6)}
.info{display:flex;justify-content:space-between;align-items:baseline}
.info small{color:#888}
.stats{display:flex;gap:20px;margin-bottom:20px;color:#888}
</style></head>
<body>
<h1>Artwork Audit</h1>
<h2>${cacheDir.replace(/\\/g, "/")}/</h2>
<div class="stats"><span>${items.length} with artwork</span><span>${missing} missing</span></div>
<div class="grid">${tiles}</div>
</body></html>`;

const outPath = "artwork-audit.html";
writeFileSync(outPath, html);
console.log(`Wrote ${outPath} — ${items.length} artworks, ${missing} missing`);
