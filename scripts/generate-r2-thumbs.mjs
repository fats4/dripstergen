#!/usr/bin/env node
/**
 * Generate `traits/<category>/thumbs/*.webp` from full-size trait WebPs (256px max edge).
 * Upload the thumbs tree to R2 so picker/preview can load small files instead of 1024px layers.
 *
 * Usage:
 *   node scripts/generate-r2-thumbs.mjs
 *   node scripts/generate-r2-thumbs.mjs --root=/path/to/traits --size=256
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const rootArg = process.argv.find((a) => a.startsWith("--root="));
const TRAIT_ROOT = rootArg
  ? path.resolve(rootArg.split("=")[1])
  : path.join(process.cwd(), "public", "traits");

const sizeArg = process.argv.find((a) => a.startsWith("--size="));
const THUMB_SIZE = sizeArg
  ? Math.min(512, Math.max(64, Number.parseInt(sizeArg.split("=")[1], 10)))
  : 256;

const SKIP = new Set(["manifest.json", "_scan.json", "_collab.json", "_monigga-stickers.json", "thumbs"]);

async function main() {
  if (!fs.existsSync(TRAIT_ROOT)) {
    console.warn("generate-r2-thumbs: trait root not found, skipping.");
    return;
  }

  let written = 0;

  for (const cat of fs.readdirSync(TRAIT_ROOT)) {
    if (cat.startsWith(".") || SKIP.has(cat)) continue;
    const dir = path.join(TRAIT_ROOT, cat);
    if (!fs.statSync(dir).isDirectory()) continue;

    const outDir = path.join(dir, "thumbs");
    fs.mkdirSync(outDir, { recursive: true });

    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith(".") || file === "thumbs") continue;
      if (!/\.webp$/i.test(file)) continue;

      const inPath = path.join(dir, file);
      if (!fs.statSync(inPath).isFile()) continue;

      const outPath = path.join(outDir, file);
      await sharp(inPath)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toFile(outPath);
      written++;
    }
  }

  console.log(`generate-r2-thumbs: wrote ${written} thumb(s) (max edge ${THUMB_SIZE}px).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
