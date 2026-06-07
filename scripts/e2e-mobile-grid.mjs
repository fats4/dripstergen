#!/usr/bin/env node
import { chromium, webkit } from "playwright";

const URL = process.argv[2] ?? "https://driplab.mondrips.com/";
const engine = process.argv[3] ?? "chromium";

const launcher = engine === "webkit" ? webkit : chromium;
const browser = await launcher.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector("#thumbGrid .thumb", { timeout: 60_000 });
await page.waitForTimeout(3000);

const result = await page.evaluate(() => {
  const cols = window.innerWidth <= 480 ? 3 : window.innerWidth <= 640 ? 4 : 6;
  const thumbs = [...document.querySelectorAll("#thumbGrid .thumb")].slice(0, cols * 3);
  const boxes = thumbs.map((el, i) => {
    const r = el.getBoundingClientRect();
    const canvas = el.querySelector("canvas");
    const cr = canvas?.getBoundingClientRect();
    return {
      i,
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      width: r.width,
      canvasOverflow: cr ? cr.height - r.height : 0,
    };
  });

  let overlap = false;
  let maxOverlapPx = 0;
  for (let row = 1; row < 3; row++) {
    for (let col = 0; col < cols; col++) {
      const cur = boxes[row * cols + col];
      const prev = boxes[(row - 1) * cols + col];
      if (!cur || !prev) continue;
      const gap = cur.top - prev.bottom;
      if (gap < -1) {
        overlap = true;
        maxOverlapPx = Math.max(maxOverlapPx, -gap);
      }
    }
  }

  const square = boxes.every((b) => Math.abs(b.width - b.height) < 4);
  const canvasOverflow = boxes.some((b) => b.canvasOverflow > 2);
  return { engine: navigator.userAgent, cols, overlap, maxOverlapPx, square, canvasOverflow, boxes };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.overlap || !result.square || result.canvasOverflow ? 1 : 0);
