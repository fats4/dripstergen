import { usesRemoteAssets } from "./assets.js";
import { getCachedImage, loadImageElementOnce, LruImageCache } from "./image-cache.js";

const CORS_SETUP_MSG =
  "Download requires CORS on assets.mondrips.com.\n\n" +
  "R2 bucket → Settings → CORS → paste scripts/r2-cors.json\n" +
  "Then purge the Cloudflare cache for assets.mondrips.com";

/**
 * @param {Blob} blob
 * @returns {Promise<HTMLImageElement>}
 */
function imageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth) {
        reject(new Error("decode failed"));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

/**
 * Load trait image for PNG export into a dedicated cache (never reuse preview cache).
 * @param {LruImageCache} cache
 * @param {string} assetUrl
 * @returns {Promise<HTMLImageElement>}
 */
export async function loadExportTraitImage(cache, assetUrl) {
  const hit = cache.get(assetUrl);
  if (hit?.naturalWidth) return hit;

  if (!usesRemoteAssets()) {
    return getCachedImage(cache, assetUrl);
  }

  /** @type {unknown} */
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const bust = attempt > 0 ? (assetUrl.includes("?") ? "&" : "?") + `_e=${Date.now()}` : "";
      const res = await fetch(`${assetUrl}${bust}`, {
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${assetUrl}`);
      const img = await imageFromBlob(await res.blob());
      cache.set(assetUrl, img);
      return img;
    } catch (err) {
      lastErr = err;
    }
  }

  try {
    const img = await loadImageElementOnce(assetUrl, true);
    cache.set(assetUrl, img);
    return img;
  } catch {
    throw lastErr instanceof Error ? lastErr : new Error(`Failed to load ${assetUrl}`);
  }
}

/** @returns {string} */
export function exportCorsSetupMessage() {
  return CORS_SETUP_MSG;
}
