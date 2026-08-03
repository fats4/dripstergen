#!/usr/bin/env node
/**
 * Remove images that were copied from update/traits/ → public/traits/ via apply:update.
 *
 * Usage:
 *   node scripts/remove-applied-update.mjs
 *   node scripts/remove-applied-update.mjs --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const CATEGORIES = ["skin", "frame", "accessories", "clothes", "glasses", "hat", "background", "stickers", "monigga", "roarnads"];
const IMAGE_EXT = /\.(png|webp|jpe?g|svg)$/i;

const dryRun = process.argv.includes("--dry-run");
const updateRoot = path.join(process.cwd(), "update", "traits");
const publicRoot = path.join(process.cwd(), "public", "traits");

if (!fs.existsSync(updateRoot)) {
  console.error("remove-applied-update: update/traits/ not found.");
  process.exit(1);
}

/** @param {string} file */
function fileStem(file) {
  return file.replace(/\.[^.]+$/i, "");
}

let removed = 0;

for (const cat of CATEGORIES) {
  const srcDir = path.join(updateRoot, cat);
  const destDir = path.join(publicRoot, cat);
  if (!fs.existsSync(srcDir) || !fs.existsSync(destDir)) continue;

  /** @type {Set<string>} */
  const updateStems = new Set();
  for (const file of fs.readdirSync(srcDir)) {
    if (file.startsWith(".") || !IMAGE_EXT.test(file)) continue;
    updateStems.add(fileStem(file));
  }
  if (updateStems.size === 0) continue;

  for (const file of fs.readdirSync(destDir)) {
    if (file.startsWith(".") || !IMAGE_EXT.test(file)) continue;
    if (!updateStems.has(fileStem(file))) continue;
    const dest = path.join(destDir, file);
    if (dryRun) {
      console.log(`[dry-run] remove ${cat}/${file}`);
    } else {
      fs.unlinkSync(dest);
    }
    removed++;
  }
}

console.log(`remove-applied-update: ${removed} file(s)${dryRun ? " (dry-run)" : " removed"}.`);

if (!dryRun && removed > 0) {
  execSync("node scripts/build-assets-manifest.mjs", { stdio: "inherit", cwd: process.cwd() });
}
