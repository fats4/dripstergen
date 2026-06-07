#!/usr/bin/env node
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://127.0.0.1:4173/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector("#thumbGrid .thumb", { timeout: 60_000 });
await page.waitForTimeout(2000);

const result = await page.evaluate(() => {
  const thumbs = [...document.querySelectorAll("#thumbGrid .thumb")].slice(0, 9);
  const boxes = thumbs.map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
  });
  let overlap = false;
  const cols = window.innerWidth <= 480 ? 3 : 4;
  for (let col = 0; col < cols; col++) {
    const colItems = boxes.filter((_, i) => i % cols === col);
    for (let i = 1; i < colItems.length; i++) {
      if (colItems[i].top < colItems[i - 1].bottom - 2) overlap = true;
    }
  }
  const square = boxes.every((b) => Math.abs(b.width - b.height) < 3);
  return { overlap, square, boxes: boxes.slice(0, 6) };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.overlap || !result.square ? 1 : 0);
