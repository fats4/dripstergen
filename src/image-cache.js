import { assetNeedsCrossOrigin } from "./assets.js";

/** @type {Map<string, Promise<HTMLImageElement>>} */
const inFlight = new Map();

/**
 * @param {string} url
 * @param {number | null | undefined} maxDecodePx
 * @returns {string}
 */
export function displayCacheKey(url, maxDecodePx) {
  if (!maxDecodePx) return url;
  return `${url}#d=${maxDecodePx}`;
}

/**
 * @param {ImageBitmap} bitmap
 * @returns {Promise<HTMLImageElement>}
 */
async function imageElementFromBitmap(bitmap) {
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("2d context");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise((/** @type {(b: Blob | null) => void} */ resolve) => {
    canvas.toBlob(resolve, "image/webp", 0.88);
  });
  if (!blob) throw new Error("toBlob failed");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageElementOnce(objectUrl, false);
    return img;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Fetch + resize at decode time to limit memory (Safari-friendly when CORS allows fetch).
 * @param {string} url
 * @param {number} maxDecodePx
 * @returns {Promise<HTMLImageElement>}
 */
async function loadImageElementCappedDecode(url, maxDecodePx) {
  const side = Math.max(32, Math.round(maxDecodePx));
  const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  if (typeof createImageBitmap !== "function") {
    return loadImageElement(url);
  }
  try {
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: side,
      resizeHeight: side,
      resizeQuality: "medium",
    });
    return await imageElementFromBitmap(bitmap);
  } catch {
    return loadImageElement(url);
  }
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

  const promise = loadImageElement(url)
    .then((img) => {
      cache.set(url, img);
      inFlight.delete(url);
      return img;
    })
    .catch((err) => {
      inFlight.delete(url);
      throw err;
    });

  inFlight.set(url, promise);
  return promise;
}

/**
 * Preview/picker loads — optional decode cap stored under {@link displayCacheKey}.
 * @param {LruImageCache} cache
 * @param {string} url
 * @param {number | null | undefined} maxDecodePx
 * @returns {Promise<HTMLImageElement>}
 */
export async function getCachedImageForDisplay(cache, url, maxDecodePx) {
  const key = displayCacheKey(url, maxDecodePx);
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (maxDecodePx
    ? loadImageElementCappedDecode(url, maxDecodePx).catch(() => loadImageElement(url))
    : loadImageElement(url)
  )
    .then((img) => {
      cache.set(key, img);
      inFlight.delete(key);
      return img;
    })
    .catch((err) => {
      inFlight.delete(key);
      throw err;
    });

  inFlight.set(key, promise);
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
