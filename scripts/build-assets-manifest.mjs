#!/usr/bin/env node
/**
 * Build traits/_scan.json from public/traits/ for upload to a remote asset server.
 *
 * Usage:
 *   node scripts/build-assets-manifest.mjs
 *   node scripts/build-assets-manifest.mjs --out ./upload/traits/_scan.json
 *
 * Upload the whole public/traits/ folder (or dist/traits/) to your CDN, e.g.:
 *   aws s3 sync public/traits/ s3://your-bucket/traits/
 *   rclone sync public/traits/ r2:bucket/traits/
 */

import fs from "node:fs";
import path from "node:path";
import { filterCollabFromScan } from "./collab-scan-filter.mjs";

const TRAIT_CATEGORIES = ["skin", "clothes", "glasses", "hat", "background", "stickers", "monigga"];
const TRAIT_EXT = /\.(png|webp|jpe?g|svg)$/i;

const outArg = process.argv.find((a) => a.startsWith("--out="));
const rootArg = process.argv.find((a) => a.startsWith("--root="));
const traitRoot = rootArg
  ? path.resolve(rootArg.split("=")[1])
  : path.join(process.cwd(), "public", "traits");
const outPath = outArg
  ? path.resolve(outArg.split("=")[1])
  : path.join(traitRoot, "_scan.json");

function preferTraitFilenames(files) {
  const best = new Map();
  for (const f of files) {
    if (!TRAIT_EXT.test(f) || f === "manifest.json" || f === "_scan.json") continue;
    const ext = path.extname(f).toLowerCase();
    const base = f.slice(0, -ext.length);
    const rank =
      ext === ".webp" ? 0 : ext === ".png" ? 1 : ext === ".jpg" || ext === ".jpeg" ? 2 : ext === ".svg" ? 3 : 9;
    const prev = best.get(base);
    if (!prev || rank < prev.rank) {
      best.set(base, { name: f, rank });
    }
  }
  return [...best.values()].map((x) => x.name).sort((a, b) => a.localeCompare(b));
}

/** @type {Record<string, string[]>} */
const scan = {};
let total = 0;

for (const cat of TRAIT_CATEGORIES) {
  const dir = path.join(traitRoot, cat);
  try {
    const raw = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
    scan[cat] = preferTraitFilenames(raw);
    total += scan[cat].length;
  } catch {
    scan[cat] = [];
  }
}

const filtered = filterCollabFromScan(scan);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(filtered)}\n`, "utf8");

let totalFiltered = 0;
for (const cat of TRAIT_CATEGORIES) totalFiltered += filtered[cat]?.length ?? 0;

console.log(
  `build-assets-manifest: wrote ${outPath} (${totalFiltered} files across ${TRAIT_CATEGORIES.length} categories)`,
);
