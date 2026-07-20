#!/usr/bin/env node
/**
 * Mobile stress: rapid skin picks + tab switches + grid scroll.
 * Usage: node scripts/e2e-mobile-stress.mjs [url] [webkit|chromium]
 */
import { chromium, webkit } from "playwright";

const URL = process.argv[2] ?? "https://driplab.mondrips.com/?debug=mobile";
const engine = process.argv[3] ?? "webkit";

const launcher = engine === "webkit" ? webkit : chromium;
const browser = await launcher.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector("#thumbGrid .thumb", { timeout: 90_000 });
await page.waitForTimeout(1500);

const tabs = page.locator("#tabs button.tab");
const tabCount = await tabs.count();

for (let round = 0; round < 3; round++) {
  for (let t = 0; t < Math.min(tabCount, 5); t++) {
    await tabs.nth(t).tap();
    await page.waitForTimeout(350);
    const thumbs = page.locator("#thumbGrid .thumb");
    const n = await thumbs.count();
    if (n > 1) {
      for (let k = 0; k < 4; k++) {
        const idx = 1 + (k % Math.min(n - 1, 8));
        await thumbs.nth(idx).tap();
        await page.waitForTimeout(120);
      }
    }
    const grid = page.locator("#thumbGrid");
    await grid.evaluate((el) => {
      el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + 280);
    });
    await page.waitForTimeout(400);
    await grid.evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop - 140);
    });
    await page.waitForTimeout(300);
  }
}

const debug = await page.evaluate(() =>
  typeof window.__dripLabDebug === "function" ? window.__dripLabDebug() : null,
);

const crashed = page.isClosed();
const result = {
  engine,
  url: URL,
  crashed,
  consoleErrors: consoleErrors.slice(0, 8),
  debug,
};

console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(crashed || consoleErrors.length > 5 ? 1 : 0);
