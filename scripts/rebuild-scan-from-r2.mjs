#!/usr/bin/env node
/**
 * Rebuild traits/_scan.json by listing objects already in R2.
 * Use when _scan.json was overwritten but image files are still in the bucket.
 *
 * Usage:
 *   node scripts/rebuild-scan-from-r2.mjs
 *   node scripts/rebuild-scan-from-r2.mjs --out=./r2-upload/traits/_scan.json
 *   node scripts/rebuild-scan-from-r2.mjs --upload
 */

import fs from "node:fs";
import path from "node:path";
import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

const TRAIT_CATEGORIES = ["skin", "clothes", "glasses", "hat", "background", "stickers"];
const IMAGE_EXT = /\.(png|webp|jpe?g|svg)$/i;

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

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outPath = outArg
  ? path.resolve(outArg.split("=")[1])
  : path.join(process.cwd(), "r2-upload", "traits", "_scan.json");
const doUpload = process.argv.includes("--upload");

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const bucket = process.env.R2_BUCKET?.trim();
const keyPrefix = (process.env.R2_KEY_PREFIX ?? "traits").replace(/^\/+|\/+$/g, "");

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("rebuild-scan-from-r2: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

/** @type {Record<string, Set<string>>} */
const byCat = Object.fromEntries(TRAIT_CATEGORIES.map((c) => [c, new Set()]));

let token;
let listed = 0;
do {
  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${keyPrefix}/`,
      ContinuationToken: token,
    }),
  );
  for (const obj of res.Contents ?? []) {
    if (!obj.Key) continue;
    listed++;
    const rel = obj.Key.slice(keyPrefix.length + 1);
    const parts = rel.split("/");
    if (parts.length !== 2) continue;
    const [cat, file] = parts;
    if (!TRAIT_CATEGORIES.includes(cat)) continue;
    if (!IMAGE_EXT.test(file) || file === "manifest.json") continue;
    byCat[cat].add(file);
  }
  token = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (token);

/** @type {Record<string, string[]>} */
const scan = {};
let total = 0;
for (const cat of TRAIT_CATEGORIES) {
  scan[cat] = [...byCat[cat]].sort((a, b) => a.localeCompare(b));
  total += scan[cat].length;
  console.log(`  ${cat}: ${scan[cat].length}`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(scan)}\n`, "utf8");
console.log(`\nrebuild-scan-from-r2: wrote ${outPath} (${total} files, listed ${listed} objects)`);

if (doUpload) {
  const key = keyPrefix ? `${keyPrefix}/_scan.json` : "_scan.json";
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(outPath),
      ContentType: "application/json",
      CacheControl: "no-cache",
    }),
  );
  console.log(`rebuild-scan-from-r2: uploaded s3://${bucket}/${key}`);
  const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (publicUrl) console.log(`Verify: ${publicUrl}/traits/_scan.json`);
}
