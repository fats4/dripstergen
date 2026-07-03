#!/usr/bin/env node
import { chromium } from "playwright";

const URL = process.argv[2] ?? "https://driplab.mondrips.com/";
const SEED = process.argv[3] ?? "102330";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

let alertText = null;
page.on("dialog", async (d) => {
  alertText = d.message();
  await d.accept();
});

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.fill("#seedInput", SEED);
await page.click("#btnSeedApply");
await page.waitForTimeout(500);

// background custom + sticker tab pick
await page.locator("nav.tabs button.tab", { hasText: "background" }).click();
await page.locator("#thumbGrid .thumb--custom-bg").click();
await page.fill("#backgroundColorHex", "#363636");
await page.locator("#backgroundColorHex").press("Enter");
await page.waitForTimeout(300);

await page.locator("nav.tabs button.tab", { hasText: /^sticker$/i }).click();
await page.locator("#stickerSubTabs button.sub-tab", { hasText: /skrumpeys/i }).click();
await page.locator("#thumbGrid .thumb").nth(5).click();
await page.waitForTimeout(300);

// Download immediately (no extra wait) — race condition test
const downloadPromise = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
await page.click("#btnDownload");
const download = await downloadPromise;

console.log(
  JSON.stringify(
    {
      seed: SEED,
      alert: alertText,
      downloaded: Boolean(download),
      filename: download?.suggestedFilename() ?? null,
      bytes: download ? (await import("node:fs")).statSync(await download.path()).size : 0,
      errors: errors.slice(0, 5),
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(download ? 0 : 1);
