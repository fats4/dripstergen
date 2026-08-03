#!/usr/bin/env node
/**
 * Prepare a local folder ready to upload to Cloudflare R2.
 *
 * Usage:
 *   node scripts/prepare-r2-upload.mjs              # from public/traits/
 *   node scripts/prepare-r2-upload.mjs --from=update  # from update/traits/ only
 *   node scripts/prepare-r2-upload.mjs --out=./r2-upload
 *
 * Then: npm run upload:r2
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const TRAIT_CATEGORIES = ["skin", "frame", "accessories", "clothes", "glasses", "hat", "background", "stickers", "monigga", "roarnads"];
/** update/traits/<src>/ → upload traits/<dest>/ */
const UPLOAD_ALIASES = [{ src: "sticker", dest: "roarnads" }];
const IMAGE_EXT = /\.(png|webp|jpe?g|svg)$/i;

const outArg = process.argv.find((a) => a.startsWith("--out="));
const fromArg = process.argv.find((a) => a.startsWith("--from="));
const fromUpdate = fromArg?.split("=")[1] === "update";

const outRoot = outArg ? path.resolve(outArg.split("=")[1]) : path.join(process.cwd(), "r2-upload");
const src = fromUpdate
  ? path.join(process.cwd(), "update", "traits")
  : path.join(process.cwd(), "public", "traits");
const dest = path.join(outRoot, "traits");

if (!fs.existsSync(src)) {
  console.error(`prepare-r2-upload: ${fromUpdate ? "update/traits" : "public/traits"} not found.`);
  process.exit(1);
}

let fileCount = 0;

/**
 * @param {string} srcDir
 * @param {string} destDir
 */
function stageCategory(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  const files = fs.readdirSync(srcDir).filter((f) => !f.startsWith(".") && IMAGE_EXT.test(f));
  if (files.length === 0) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    fileCount++;
  }
}

/**
 * @param {string} root
 * @returns {number}
 */
function countImages(root) {
  let n = 0;
  for (const cat of TRAIT_CATEGORIES) {
    const dir = path.join(root, cat);
    if (!fs.existsSync(dir)) continue;
    n += fs.readdirSync(dir).filter((f) => !f.startsWith(".") && IMAGE_EXT.test(f)).length;
  }
  for (const { src: aliasSrc } of UPLOAD_ALIASES) {
    const dir = path.join(root, aliasSrc);
    if (!fs.existsSync(dir)) continue;
    n += fs.readdirSync(dir).filter((f) => !f.startsWith(".") && IMAGE_EXT.test(f)).length;
  }
  return n;
}

const pending = countImages(src);
if (pending === 0) {
  console.error(
    fromUpdate
      ? "prepare-r2-upload: update/traits/ is empty — add files to update/traits/<category>/ first."
      : "prepare-r2-upload: no image files found.",
  );
  process.exit(1);
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const cat of TRAIT_CATEGORIES) {
  stageCategory(path.join(src, cat), path.join(dest, cat));
}
for (const { src: aliasSrc, dest: aliasDest } of UPLOAD_ALIASES) {
  stageCategory(path.join(src, aliasSrc), path.join(dest, aliasDest));
}

if (!fromUpdate) {
  const scanPath = path.join(dest, "_scan.json");
  try {
    execSync(`node scripts/build-assets-manifest.mjs --root=${dest} --out=${scanPath}`, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  } catch {
    console.warn("prepare-r2-upload: could not write _scan.json");
  }
} else {
  console.log("prepare-r2-upload: skipped _scan.json (incremental update — catalog rebuilt after upload)");
}

console.log(`prepare-r2-upload: ready at ${dest} (${fileCount} files, source: ${fromUpdate ? "update/" : "public/"})`);
console.log(fromUpdate ? "Next: npm run upload:update" : "Next: npm run upload:r2");
