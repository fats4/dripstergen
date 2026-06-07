#!/usr/bin/env node
/**
 * Restore update/traits/ from dist/traits/ — files that are NOT in the baseline catalog.
 * Use when update/ was cleared but dist/ still has the bulk-update build snapshot.
 */

import fs from "node:fs";
import path from "node:path";
import { BASELINE } from "./trait-baseline.mjs";

const IMAGE_EXT = /\.(png|webp|jpe?g|svg)$/i;
const distRoot = path.join(process.cwd(), "dist", "traits");
const updateRoot = path.join(process.cwd(), "update", "traits");

if (!fs.existsSync(distRoot)) {
  console.error("restore-update-from-dist: dist/traits not found — run npm run build first.");
  process.exit(1);
}

let copied = 0;

for (const [cat, baselineFiles] of Object.entries(BASELINE)) {
  const srcDir = path.join(distRoot, cat);
  const destDir = path.join(updateRoot, cat);
  if (!fs.existsSync(srcDir)) continue;

  const baselineSet = new Set(baselineFiles);
  fs.mkdirSync(destDir, { recursive: true });

  for (const file of fs.readdirSync(srcDir)) {
    if (file.startsWith(".") || !IMAGE_EXT.test(file)) continue;
    if (baselineSet.has(file)) continue;

    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    copied++;
  }
}

console.log(`restore-update-from-dist: ${copied} file(s) copied to update/traits/.`);
