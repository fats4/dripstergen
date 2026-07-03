#!/usr/bin/env node
/**
 * Rename trait files: spaces → underscores (R2 / S3 key safety).
 *
 * Usage:
 *   node scripts/sanitize-trait-filenames.mjs --root=update/traits
 */

import fs from "node:fs";
import path from "node:path";

const rootArg = process.argv.find((a) => a.startsWith("--root="));
const traitRoot = rootArg
  ? path.resolve(rootArg.split("=")[1])
  : path.join(process.cwd(), "update", "traits");

const CATEGORIES = ["skin", "frame", "accessories", "clothes", "glasses", "hat", "background", "stickers", "monigga"];

let renamed = 0;

for (const cat of CATEGORIES) {
  const dir = path.join(traitRoot, cat);
  if (!fs.existsSync(dir)) continue;

  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith(".") || !file.includes(" ")) continue;
    const next = file.replace(/ /g, "_");
    const from = path.join(dir, file);
    const to = path.join(dir, next);
    if (fs.existsSync(to)) {
      console.warn(`sanitize: skip ${cat}/${file} → ${next} (target exists)`);
      continue;
    }
    fs.renameSync(from, to);
    console.log(`sanitize: ${cat}/${file} → ${next}`);
    renamed++;
  }
}

console.log(`sanitize-trait-filenames: ${renamed} renamed.`);
