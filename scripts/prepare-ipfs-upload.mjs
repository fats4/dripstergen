#!/usr/bin/env node
/**
 * Prepare a folder ready to pin/upload to IPFS.
 *
 * Output: ./ipfs-upload/traits/  (upload THIS folder's parent contents, or pin traits/ as directory)
 *
 * Usage:
 *   node scripts/prepare-ipfs-upload.mjs
 *   node scripts/prepare-ipfs-upload.mjs --out ./ipfs-upload
 *
 * Then pin with your tool of choice, e.g.:
 *   npx ipfs add -r -Q ipfs-upload/traits
 *   # or Pinata web UI: upload ipfs-upload/traits as folder
 *
 * Set the returned directory CID in .env:
 *   VITE_IPFS_CID=Qm...
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outRoot = outArg ? outArg.split("=")[1] : path.join(process.cwd(), "ipfs-upload");
const src = path.join(process.cwd(), "public", "traits");
const dest = path.join(outRoot, "traits");

if (!fs.existsSync(src)) {
  console.error("prepare-ipfs-upload: public/traits not found.");
  process.exit(1);
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

try {
  execSync("node scripts/build-assets-manifest.mjs", { stdio: "inherit", cwd: process.cwd() });
  fs.copyFileSync(
    path.join(process.cwd(), "public", "traits", "_scan.json"),
    path.join(dest, "_scan.json"),
  );
} catch {
  console.warn("prepare-ipfs-upload: could not refresh _scan.json");
}

console.log(`prepare-ipfs-upload: ready at ${dest}`);
console.log("Upload/pin this directory to IPFS, then set VITE_IPFS_CID to the folder CID.");
