#!/usr/bin/env node
/**
 * Upload traits/ to Cloudflare R2 (S3-compatible API).
 *
 * Setup (Cloudflare Dashboard):
 *   1. R2 → Create bucket (e.g. dripstergen-assets)
 *   2. Bucket → Settings → Public access → Allow + copy r2.dev URL
 *   3. R2 → Manage R2 API Tokens → Create (Object Read & Write)
 *   4. Bucket → Settings → CORS → paste scripts/r2-cors.json rules
 *
 * Env (.env or shell):
 *   R2_ACCOUNT_ID=...
 *   R2_ACCESS_KEY_ID=...
 *   R2_SECRET_ACCESS_KEY=...
 *   R2_BUCKET=dripstergen-assets
 *
 * Usage:
 *   npm run upload:r2
 *   npm run upload:r2 -- --dir=./r2-upload/traits
 *   npm run upload:r2 -- --dry-run
 *   npm run upload:r2 -- --rebuild-scan   # after upload, rebuild _scan.json from bucket
 *
 * By default _scan.json is NOT uploaded (use --with-scan). Prefer --rebuild-scan after incremental updates.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

const MIME = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const dryRun = process.argv.includes("--dry-run");
const withScan = process.argv.includes("--with-scan");
const rebuildScan = process.argv.includes("--rebuild-scan");
const dirArg = process.argv.find((a) => a.startsWith("--dir="));
const srcRoot = dirArg
  ? path.resolve(dirArg.split("=")[1])
  : path.join(process.cwd(), "r2-upload", "traits");

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const bucket = process.env.R2_BUCKET?.trim();
const keyPrefix = (process.env.R2_KEY_PREFIX ?? "traits").replace(/^\/+|\/+$/g, "");

if (!dryRun && (!accountId || !accessKeyId || !secretAccessKey || !bucket)) {
  console.error("upload-r2: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET");
  process.exit(1);
}

if (!fs.existsSync(srcRoot)) {
  console.error(`upload-r2: source not found: ${srcRoot}`);
  console.error("  Run: npm run prepare:r2:update");
  process.exit(1);
}

/** @type {{ local: string; key: string; contentType: string }[]} */
const files = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      walk(abs);
      continue;
    }
    const rel = path.relative(srcRoot, abs).split(path.sep).join("/");
    if (!withScan && (rel === "_scan.json" || rel === "manifest.json")) return;
    const key = keyPrefix ? `${keyPrefix}/${rel}` : rel;
    const ext = path.extname(name).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    files.push({ local: abs, key, contentType });
  }
}

walk(srcRoot);

if (files.length === 0) {
  console.error("upload-r2: no files to upload.");
  process.exit(1);
}

console.log(`upload-r2: ${files.length} files from ${srcRoot} → s3://${bucket}/${keyPrefix}/`);

if (dryRun) {
  for (const f of files.slice(0, 5)) console.log(`  [dry-run] ${f.key}`);
  if (files.length > 5) console.log(`  ... and ${files.length - 5} more`);
  process.exit(0);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const concurrency = 20;
let done = 0;
let failed = 0;

async function uploadOne(/** @type {{ local: string; key: string; contentType: string }} */ file) {
  const body = fs.readFileSync(file.local);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: file.key,
      Body: body,
      ContentType: file.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  done++;
  if (done % 100 === 0 || done === files.length) {
    process.stdout.write(`\rupload-r2: ${done}/${files.length}`);
  }
}

const queue = [...files];
async function worker() {
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file) return;
    try {
      await uploadOne(file);
    } catch (err) {
      failed++;
      console.error(`\nupload-r2: failed ${file.key}:`, err instanceof Error ? err.message : err);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(failed ? `\nupload-r2: done with ${failed} error(s).` : "\nupload-r2: done.");

if (failed) process.exit(1);

if (rebuildScan && !dryRun) {
  console.log("\nupload-r2: rebuilding _scan.json from bucket...");
  execSync("node scripts/rebuild-scan-from-r2.mjs --upload", {
    stdio: "inherit",
    cwd: process.cwd(),
  });
}

const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, "");
if (publicUrl) {
  console.log("\nAdd to .env and GitHub Secret VITE_ASSETS_BASE_URL:");
  console.log(`  VITE_ASSETS_BASE_URL=${publicUrl}`);
  console.log("\nTest:");
  console.log(`  ${publicUrl}/traits/_scan.json`);
} else {
  console.log("\nSet R2_PUBLIC_URL to print .env lines (bucket public r2.dev URL).");
}
