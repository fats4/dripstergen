#!/usr/bin/env node
/** Sticker via search + custom bg — matches user workflow */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "https://driplab.mondrips.com/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ acceptDownloads: true });

let alertText = null;
page.on("dialog", async (d) => {
  alertText = d.message();
  await d.accept();
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });

for (const tab of ["skin", "clothes", "hat"]) {
  await page.locator("nav.tabs button.tab", { hasText: tab }).click();
  await page.locator("#thumbGrid .thumb").nth(1).click();
  await page.waitForTimeout(400);
}

await page.locator("nav.tabs button.tab", { hasText: "background" }).click();
await page.locator("#thumbGrid .thumb--custom-bg").click();
await page.fill("#backgroundColorHex", "#363636");
await page.locator("#backgroundColorHex").press("Enter");

await page.locator("nav.tabs button.tab", { hasText: /^sticker$/i }).click();
await page.locator("#stickerSubTabs button.sub-tab", { hasText: /skrumpeys/i }).click();
await page.fill("#stickerSearchInput", "109");
await page.click("#btnStickerSearchApply");
await page.waitForTimeout(800);

const dl = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
await page.click("#btnDownload");
const download = await dl;

console.log(
  JSON.stringify({ alert: alertText, ok: Boolean(download), file: download?.suggestedFilename() }, null, 2),
);
await browser.close();
process.exit(download ? 0 : 1);
