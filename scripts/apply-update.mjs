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

const CATEGORIES = ["skin", "frame", "accessories", "clothes", "glasses", "hat", "background", "stickers", "monigga", "roarnads"];
/** update/traits/<src>/ → public/traits/<dest>/ */
const UPDATE_ALIASES = [{ src: "sticker", dest: "roarnads" }];
const IMAGE_EXT = /\.(png|webp|jpe?g|svg)$/i;

const dryRun = process.argv.includes("--dry-run");
const updateRoot = path.join(process.cwd(), "update", "traits");
const publicRoot = path.join(process.cwd(), "public", "traits");

if (!fs.existsSync(updateRoot)) {
  console.error("apply-update: update/traits/ not found.");
  process.exit(1);
}

let copied = 0;

/**
 * @param {string} srcDir
 * @param {string} destDir
 * @param {string} label
 */
function copyUpdateCategory(srcDir, destDir, label) {
  if (!fs.existsSync(srcDir)) return;

  const files = fs.readdirSync(srcDir).filter((f) => !f.startsWith(".") && IMAGE_EXT.test(f));
  if (files.length === 0) return;

  if (!dryRun) fs.mkdirSync(destDir, { recursive: true });

  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (!fs.statSync(src).isFile()) continue;

    if (dryRun) {
      console.log(`[dry-run] ${label}/${file}`);
      copied++;
      continue;
    }

    fs.copyFileSync(src, dest);
    console.log(`copied ${label}/${file}`);
    copied++;
  }
}

for (const cat of CATEGORIES) {
  copyUpdateCategory(
    path.join(updateRoot, cat),
    path.join(publicRoot, cat),
    cat,
  );
}

for (const { src, dest } of UPDATE_ALIASES) {
  copyUpdateCategory(
    path.join(updateRoot, src),
    path.join(publicRoot, dest),
    `${src}→${dest}`,
  );
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
