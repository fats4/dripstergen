#!/usr/bin/env node
import { chromium, webkit } from "playwright";

const URL = process.argv[2] ?? "https://driplab.mondrips.com/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });

const result = { url: URL, checks: {} };

await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector("nav.tabs button.tab", { timeout: 60_000 });

const tabs = await page.locator("nav.tabs button.tab").allTextContents();
result.checks.tabs = tabs;
result.checks.hasSkrumpeysTab = tabs.some((t) => /skrumpeys/i.test(t));
result.checks.hasStickersTabLabel = tabs.some((t) => t.trim() === "stickers");

// Controls hidden on skin tab
result.checks.controlsHiddenOnSkin = await page.locator("#stickerControls").isHidden();

// Pick skrumpeys + first sticker
await page.locator("nav.tabs button.tab", { hasText: /skrumpeys/i }).click();
await page.waitForTimeout(500);
const thumbs = page.locator("#thumbGrid .thumb");
if ((await thumbs.count()) > 1) await thumbs.nth(1).click();
await page.waitForTimeout(800);

result.checks.controlsVisibleOnSkrumpeysWithSticker = !(await page.locator("#stickerControls").isHidden());

// Back to skin — controls should hide
await page.locator("nav.tabs button.tab", { hasText: /^skin$/i }).click();
await page.waitForTimeout(300);
result.checks.controlsHiddenAfterLeaveSkrumpeys = await page.locator("#stickerControls").isHidden();

// Mobile grid overlap
result.checks.mobileGrid = await page.evaluate(() => {
  const cols = 3;
  const boxes = [...document.querySelectorAll("#thumbGrid .thumb")].slice(0, 6).map((el) => el.getBoundingClientRect());
  let overlap = false;
  for (let col = 0; col < cols; col++) {
    const a = boxes[col];
    const b = boxes[cols + col];
    if (a && b && b.top < a.bottom - 1) overlap = true;
  }
  return { overlap, count: boxes.length };
});

// Download smoke
const dl = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
await page.locator("nav.tabs button.tab", { hasText: /^skin$/i }).click();
await page.waitForTimeout(200);
await page.click("#btnDownload");
const download = await dl;
result.checks.downloadOk = Boolean(download);

result.ok =
  result.checks.hasSkrumpeysTab &&
  !result.checks.hasStickersTabLabel &&
  result.checks.controlsHiddenOnSkin &&
  result.checks.controlsVisibleOnSkrumpeysWithSticker &&
  result.checks.controlsHiddenAfterLeaveSkrumpeys &&
  !result.checks.mobileGrid.overlap &&
  result.checks.downloadOk;

console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.ok ? 0 : 1);
