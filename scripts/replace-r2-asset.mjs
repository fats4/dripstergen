#!/usr/bin/env node
/**
 * Replace one trait/sticker on R2: delete old basename variants, upload new file, rebuild scan, verify.
 *
 * Usage:
 *   node scripts/replace-r2-asset.mjs --category=monigga --file=update/traits/monigga/Glock.png
 *   node scripts/replace-r2-asset.mjs --category=monigga --basename=Glock --file=update/traits/monigga/Glock.png --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const IMAGE_EXT = /\.(png|webp|jpe?g|svg)$/i;

const MIME = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

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

const dryRun = process.argv.includes("--dry-run");
const categoryArg = process.argv.find((a) => a.startsWith("--category="));
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const basenameArg = process.argv.find((a) => a.startsWith("--basename="));

const category = categoryArg?.split("=")[1]?.trim();
const localFile = fileArg ? path.resolve(fileArg.split("=")[1]) : null;

if (!category || !localFile) {
  console.error("replace-r2-asset: --category= and --file= are required");
  process.exit(1);
}

if (!fs.existsSync(localFile) || !IMAGE_EXT.test(localFile)) {
  console.error(`replace-r2-asset: not an image file: ${localFile}`);
  process.exit(1);
}

const localName = path.basename(localFile);
const basename =
  basenameArg?.split("=")[1]?.trim() ?? localName.replace(/\.[^.]+$/i, "");

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const bucket = process.env.R2_BUCKET?.trim();
const keyPrefix = (process.env.R2_KEY_PREFIX ?? "traits").replace(/^\/+|\/+$/g, "");
const publicUrl = (process.env.R2_PUBLIC_URL ?? process.env.VITE_ASSETS_BASE_URL ?? "https://assets.mondrips.com")
  .trim()
  .replace(/\/+$/, "");

if (!dryRun && (!accountId || !accessKeyId || !secretAccessKey || !bucket)) {
  console.error("replace-r2-asset: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env");
  process.exit(1);
}

const client = dryRun
  ? null
  : new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

/** @param {string} prefix */
async function listKeys(prefix) {
  /** @type {string[]} */
  const keys = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** @param {string[]} keys */
async function deleteKeys(keys) {
  if (keys.length === 0) return;
  if (dryRun) {
    for (const key of keys) console.log(`  [dry-run] delete ${key}`);
    return;
  }
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
  console.log(`replace-r2-asset: deleted ${keys.length} object(s)`);
}

const baseLower = basename.toLowerCase();
const catPrefix = keyPrefix ? `${keyPrefix}/${category}/` : `${category}/`;
const allInCategory = dryRun ? [] : await listKeys(catPrefix);

/** Delete same basename in category root and thumbs/ */
const toDelete = allInCategory.filter((key) => {
  const rel = key.slice(catPrefix.length);
  const parts = rel.split("/");
  const file = parts.at(-1) ?? "";
  if (!IMAGE_EXT.test(file)) return false;
  const stem = file.replace(/\.[^.]+$/i, "").toLowerCase();
  return stem === baseLower;
});

console.log(`replace-r2-asset: ${category}/${basename} ← ${localFile}`);
if (toDelete.length) {
  console.log("replace-r2-asset: removing old variant(s):");
  for (const key of toDelete) console.log(`  ${key.split("/").slice(-2).join("/")}`);
} else {
  console.log("replace-r2-asset: no existing variant on R2");
}

await deleteKeys(toDelete);

const uploadKey = keyPrefix ? `${keyPrefix}/${category}/${localName}` : `${category}/${localName}`;
const ext = path.extname(localName).toLowerCase();
const contentType = MIME[ext] ?? "application/octet-stream";

if (dryRun) {
  console.log(`  [dry-run] upload ${uploadKey}`);
} else {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: uploadKey,
      Body: fs.readFileSync(localFile),
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  console.log(`replace-r2-asset: uploaded ${uploadKey}`);
}

if (!dryRun) {
  console.log("\nreplace-r2-asset: rebuilding _scan.json from bucket...");
  execSync("node scripts/rebuild-scan-from-r2.mjs --upload", {
    stdio: "inherit",
    cwd: process.cwd(),
  });
}

// Verify R2 catalog + asset reachable
const scanUrl = `${publicUrl}/traits/_scan.json`;

/** @param {string} url @param {number} attempts */
async function fetchWithRetry(url, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/** @type {Record<string, string[]>} */
let scan;
try {
  scan = await fetchWithRetry(scanUrl).then((r) => r.json());
} catch (err) {
  console.error("replace-r2-asset: verify failed — could not fetch scan:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const moniggaList = scan[category] ?? [];
const matches = moniggaList.filter((f) => f.replace(/\.[^.]+$/i, "").toLowerCase() === baseLower);

console.log(`\nreplace-r2-asset: R2 catalog ${category}: ${moniggaList.length} file(s)`);
console.log(`replace-r2-asset: ${basename} entries in scan:`, matches);

if (matches.length !== 1) {
  console.error(`FAIL: expected exactly 1 scan entry for ${basename}, got ${matches.length}`);
  process.exit(1);
}

const assetUrl = `${publicUrl}/traits/${category}/${matches[0]}`;
const head = await fetch(assetUrl, { method: "HEAD", cache: "no-store" });
if (!head.ok) {
  console.error(`FAIL: asset not reachable ${assetUrl} (HTTP ${head.status})`);
  process.exit(1);
}

const localSize = fs.statSync(localFile).size;
const remoteSize = Number(head.headers.get("content-length") ?? 0);
console.log(`replace-r2-asset: OK ${assetUrl}`);
console.log(`replace-r2-asset: size local=${localSize} remote=${remoteSize}`);

if (remoteSize > 0 && localSize !== remoteSize && !dryRun) {
  console.warn("WARN: local and remote file sizes differ (CDN may still be updating)");
}

console.log("\nNext: git push origin main  (redeploy driplab with fresh _scan.json)");
