#!/usr/bin/env node
/**
 * E2E: production download with all traits + custom background.
 * Usage: node scripts/e2e-download.mjs [url]
 */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "https://driplab.mondrips.com/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

const logs = [];
page.on("console", (msg) => logs.push(`[console] ${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

let alertText = null;
page.on("dialog", async (dialog) => {
  alertText = dialog.message();
  await dialog.accept();
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });

// Wait for catalog
await page.waitForFunction(() => {
  const grid = document.getElementById("thumbGrid");
  return grid && grid.querySelectorAll(".thumb").length > 1;
}, { timeout: 60_000 });

// Pick traits on each tab (index 1 = first real trait)
for (const tab of ["skin", "clothes", "hat", "glasses", "background", "sticker"]) {
  await page.locator("nav.tabs button.tab", { hasText: tab }).click();
  await page.waitForTimeout(400);
  if (tab === "sticker") {
    await page.locator("#stickerSubTabs button.sub-tab", { hasText: /skrumpeys/i }).click();
    await page.waitForTimeout(200);
  }
  if (tab === "background") {
    await page.locator("#thumbGrid .thumb--custom-bg").click();
    await page.fill("#backgroundColorHex", "#363636");
    await page.locator("#backgroundColorHex").press("Enter");
    await page.waitForTimeout(400);
    continue;
  }
  const thumbs = page.locator("#thumbGrid .thumb");
  const n = await thumbs.count();
  if (n > 1) {
    await thumbs.nth(1).click();
    await page.waitForTimeout(500);
  }
}

await page.waitForTimeout(1500);

const downloadPromise = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
await page.click("#btnDownload");

const download = await downloadPromise;
const result = {
  url: URL,
  alert: alertText,
  downloaded: Boolean(download),
  filename: download ? download.suggestedFilename() : null,
  console: logs.filter((l) => l.includes("[download]") || l.includes("Failed") || l.includes("CORS")),
};

if (download) {
  const path = await download.path();
  const fs = await import("node:fs");
  result.bytes = fs.statSync(path).size;
}

console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.downloaded ? 0 : 1);
