import { assetNeedsCrossOrigin } from "./assets.js";

/** @type {Map<string, Promise<HTMLImageElement>>} */
const inFlight = new Map();

let loadSlots = 0;
/** @type {Array<() => void>} */
const loadWaitQueue = [];

/** @returns {number} */
function maxParallelImageLoads() {
  if (typeof window === "undefined") return 8;
  if (window.innerWidth < 768) return 3;
  if (window.matchMedia("(pointer: coarse)").matches) return 3;
  return 8;
}

/** @returns {Promise<void>} */
function acquireLoadSlot() {
  const max = maxParallelImageLoads();
  if (loadSlots < max) {
    loadSlots += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    loadWaitQueue.push(() => {
      loadSlots += 1;
      resolve();
    });
  });
}

function releaseLoadSlot() {
  loadSlots = Math.max(0, loadSlots - 1);
  const next = loadWaitQueue.shift();
  if (next) next();
}

/**
 * @param {string} url
 * @param {boolean} [useCors]
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageElementOnce(url, useCors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Try CORS first (for Download PNG). Fall back without CORS so thumbs/preview work
 * when R2 bucket CORS is not configured yet.
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageElement(url) {
  const wantsCors = assetNeedsCrossOrigin(url);
  if (!wantsCors) return loadImageElementOnce(url, false);
  return loadImageElementOnce(url, true).catch(() => loadImageElementOnce(url, false));
}

export class LruImageCache {
  /**
   * @param {number} [max]
   */
  constructor(max = 150) {
    this.max = max;
    /** @type {Map<string, HTMLImageElement>} */
    this.map = new Map();
  }

  /**
   * @param {string} url
   * @returns {HTMLImageElement | undefined}
   */
  get(url) {
    const img = this.map.get(url);
    if (!img) return undefined;
    this.map.delete(url);
    this.map.set(url, img);
    return img;
  }

  /**
   * @param {string} url
   * @param {HTMLImageElement} img
   */
  set(url, img) {
    if (this.map.has(url)) this.map.delete(url);
    this.map.set(url, img);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }
  }

  /**
   * @param {string} url
   * @returns {boolean}
   */
  has(url) {
    return this.map.has(url);
  }
}

/**
 * @param {LruImageCache} cache
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
export async function getCachedImage(cache, url) {
  const hit = cache.get(url);
  if (hit) return hit;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const promise = (async () => {
    await acquireLoadSlot();
    try {
      const img = await loadImageElement(url);
      cache.set(url, img);
      return img;
    } finally {
      inFlight.delete(url);
      releaseLoadSlot();
    }
  })();

  inFlight.set(url, promise);
  return promise;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<void>} worker
 * @param {number} concurrency
 */
export async function runPool(items, worker, concurrency) {
  let cursor = 0;
  const n = Math.min(concurrency, items.length);

  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: n }, next));
}
