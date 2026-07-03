#!/usr/bin/env node
/**
 * Convert PNG/JPEG in public/traits/<category>/ → WebP (default quality 85).
 *
 * Usage:
 *   node scripts/optimize-traits.mjs
 *   node scripts/optimize-traits.mjs --replace          # remove png/jpeg after success
 *   node scripts/optimize-traits.mjs --quality=82
 *
 * Without --replace: originals remain; the app prefers .webp when both exist (dedupe).
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const rootArg = process.argv.find((a) => a.startsWith("--root="));
const TRAIT_ROOT = rootArg
  ? path.resolve(rootArg.split("=")[1])
  : path.join(process.cwd(), "public", "traits");
const CATEGORIES = ["skin", "accessories", "frame", "clothes", "glasses", "hat", "background", "stickers", "monigga"];
const SOURCE_EXT = /\.(png|jpg|jpeg)$/i;

const args = process.argv.slice(2);
const replaceSources = args.includes("--replace");
const qualityArg = args.find((a) => a.startsWith("--quality="));
const quality = qualityArg
  ? Math.min(100, Math.max(1, Number.parseInt(qualityArg.split("=")[1], 10)))
  : 85;

async function main() {
  if (!fs.existsSync(TRAIT_ROOT)) {
    console.warn("optimize-traits: public/traits not found, skipping.");
    return;
  }

  let written = 0;
  let removed = 0;

  for (const cat of CATEGORIES) {
    const dir = path.join(TRAIT_ROOT, cat);
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith(".") || file === "manifest.json") continue;
      if (!SOURCE_EXT.test(file)) continue;

      const inPath = path.join(dir, file);
      const st = fs.statSync(inPath);
      if (!st.isFile()) continue;

      const { name: base } = path.parse(file);
      const outPath = path.join(dir, `${base}.webp`);

      await sharp(inPath)
        .webp({ quality, effort: 4 })
        .toFile(outPath);

      written++;
      if (replaceSources) {
        fs.unlinkSync(inPath);
        removed++;
      }
    }
  }

  console.log(
    `optimize-traits: wrote ${written} WebP file(s) (quality=${quality}).` +
      (replaceSources
        ? ` Removed ${removed} png/jpeg source(s).`
        : " Kept png/jpeg sources (use --replace to remove)."),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
