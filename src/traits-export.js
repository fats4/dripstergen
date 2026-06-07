import { usesRemoteAssets } from "./assets.js";
import { getCachedImage, LruImageCache } from "./image-cache.js";

const CORS_SETUP_MSG =
  "Download butuh CORS di assets.mondrips.com.\n\n" +
  "R2 bucket → Settings → CORS → paste scripts/r2-cors.json\n" +
  "Lalu purge cache Cloudflare untuk assets.mondrips.com";

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

  const res = await fetch(assetUrl, { mode: "cors", credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const img = await imageFromBlob(await res.blob());
  cache.set(assetUrl, img);
  return img;
}

/** @returns {string} */
export function exportCorsSetupMessage() {
  return CORS_SETUP_MSG;
}
