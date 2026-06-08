#!/usr/bin/env node
/**
 * Verify trait catalog on R2 CDN and baked into driplab (if deployed).
 *
 * Usage:
 *   node scripts/verify-catalog.mjs
 *   node scripts/verify-catalog.mjs --min-stickers=100
 */

const assetsBase = (process.env.VITE_ASSETS_BASE_URL ?? "https://assets.mondrips.com").replace(
  /\/+$/,
  "",
);
const siteUrl = (process.env.DRIPLAB_URL ?? "https://driplab.mondrips.com").replace(/\/+$/, "");

const minArg = process.argv.find((a) => a.startsWith("--min-stickers="));
const minStickers = minArg ? Number.parseInt(minArg.split("=")[1], 10) : 100;

/** @param {string} url */
async function fetchScan(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return /** @type {Record<string, string[]>} */ (await res.json());
}

/** @param {Record<string, string[]>} scan */
function summarize(scan) {
  return Object.fromEntries(
    Object.entries(scan).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
  );
}

/** @param {Record<string, number>} counts */
function total(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

let failed = false;

try {
  const r2Scan = await fetchScan(`${assetsBase}/traits/_scan.json`);
  const r2Counts = summarize(r2Scan);
  console.log("R2 catalog:", r2Counts, `total=${total(r2Counts)}`);

  if ((r2Counts.stickers ?? 0) < minStickers) {
    console.error(`FAIL: stickers < ${minStickers}`);
    failed = true;
  }
  if ((r2Counts.skin ?? 0) === 0) {
    console.error("FAIL: skin is empty");
    failed = true;
  }

  // Sample asset CORS
  const sample = r2Scan.skin?.[0] ?? r2Scan.clothes?.[0];
  if (sample) {
    const cat = r2Scan.skin?.[0] ? "skin" : "clothes";
    const assetUrl = `${assetsBase}/traits/${cat}/${sample}`;
    const head = await fetch(assetUrl, {
      method: "HEAD",
      headers: { Origin: siteUrl },
    });
    const cors = head.headers.get("access-control-allow-origin");
    console.log(`CORS sample (${cat}/${sample}):`, cors ?? "missing");
    if (!cors) {
      console.error("FAIL: CORS header missing on sample asset");
      failed = true;
    }
  }
} catch (err) {
  console.error("R2 catalog check failed:", err instanceof Error ? err.message : err);
  failed = true;
}

try {
  const siteScan = await fetchScan(`${siteUrl}/traits/_scan.json`);
  const siteCounts = summarize(siteScan);
  console.log("Site catalog:", siteCounts, `total=${total(siteCounts)}`);

  const r2Scan = await fetchScan(`${assetsBase}/traits/_scan.json`);
  const r2Total = total(summarize(r2Scan));
  const siteTotal = total(siteCounts);
  if (siteTotal < r2Total * 0.9) {
    console.warn(
      `WARN: site catalog (${siteTotal}) behind R2 (${r2Total}) — push/redeploy main to refresh`,
    );
  } else {
    console.log("Site catalog OK (in sync with R2).");
  }
} catch (err) {
  console.warn("Site catalog check skipped:", err instanceof Error ? err.message : err);
}

process.exit(failed ? 1 : 0);
