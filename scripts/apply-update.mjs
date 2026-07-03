#!/usr/bin/env node
/**
 * Copy new/updated images from update/traits/ → public/traits/, then refresh _scan.json.
 *
 * Usage:
 *   node scripts/apply-update.mjs
 *   node scripts/apply-update.mjs --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const CATEGORIES = ["skin", "frame", "accessories", "clothes", "glasses", "hat", "background", "stickers", "monigga"];
const IMAGE_EXT = /\.(png|webp|jpe?g|svg)$/i;

const dryRun = process.argv.includes("--dry-run");
const updateRoot = path.join(process.cwd(), "update", "traits");
const publicRoot = path.join(process.cwd(), "public", "traits");

if (!fs.existsSync(updateRoot)) {
  console.error("apply-update: update/traits/ not found.");
  process.exit(1);
}

let copied = 0;
let skipped = 0;

for (const cat of CATEGORIES) {
  const srcDir = path.join(updateRoot, cat);
  const destDir = path.join(publicRoot, cat);

  if (!fs.existsSync(srcDir)) continue;

  const files = fs.readdirSync(srcDir).filter((f) => !f.startsWith(".") && IMAGE_EXT.test(f));
  if (files.length === 0) continue;

  if (!dryRun) fs.mkdirSync(destDir, { recursive: true });

  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (!fs.statSync(src).isFile()) continue;

    if (dryRun) {
      console.log(`[dry-run] ${cat}/${file}`);
      copied++;
      continue;
    }

    fs.copyFileSync(src, dest);
    console.log(`copied ${cat}/${file}`);
    copied++;
  }
}

if (copied === 0) {
  console.log("apply-update: no images in update/traits/ — drop files into category folders first.");
  process.exit(0);
}

console.log(`apply-update: ${copied} file(s)${dryRun ? " (dry-run)" : " copied"}.`);

if (!dryRun) {
  execSync("node scripts/build-assets-manifest.mjs", { stdio: "inherit", cwd: process.cwd() });
  console.log("apply-update: _scan.json updated. Run npm run dev to preview.");
}
