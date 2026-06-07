#!/usr/bin/env node
/**
 * Apply scripts/r2-cors.json to R2 bucket (required for driplab.mondrips.com fetch/images).
 *
 * Usage: npm run apply:r2-cors
 */

import fs from "node:fs";
import path from "node:path";
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";

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

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const bucket = process.env.R2_BUCKET?.trim();

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("apply-r2-cors: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET");
  process.exit(1);
}

const corsPath = path.join(process.cwd(), "scripts", "r2-cors.json");
const rules = JSON.parse(fs.readFileSync(corsPath, "utf8"));

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

try {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: rules },
    }),
  );

  const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log("apply-r2-cors: OK for bucket", bucket);
  console.log(JSON.stringify(current.CORSRules, null, 2));
} catch (err) {
  const code = err && typeof err === "object" && "Code" in err ? err.Code : "";
  console.error("apply-r2-cors: API failed", code || err);
  console.error("\nSet CORS manually in Cloudflare Dashboard:");
  console.error("  R2 → your bucket → Settings → CORS policy → paste scripts/r2-cors.json");
  console.error("\nRequired for Download PNG on driplab.mondrips.com.");
  process.exit(1);
}
