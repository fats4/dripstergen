import { toTraitsProxyUrl, usesRemoteAssets } from "./assets.js";
import { getCachedImage, LruImageCache } from "./image-cache.js";

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
 * Opaque cross-origin fetch → blob URL is same-origin → safe for canvas export.
 * @param {string} assetUrl
 * @returns {Promise<HTMLImageElement>}
 */
async function loadExportImageOpaque(assetUrl) {
  try {
    const corsRes = await fetch(assetUrl, { mode: "cors", credentials: "omit", cache: "force-cache" });
    if (corsRes.ok) return imageFromBlob(await corsRes.blob());
  } catch {
    /* R2 CORS often unset — fall back to opaque fetch */
  }

  const res = await fetch(assetUrl, { mode: "no-cors", credentials: "omit", cache: "force-cache" });
  const blob = await res.blob();
  if (!blob.size) throw new Error("empty response");
  return imageFromBlob(blob);
}

/**
 * Load trait image for PNG export (same-origin blob — safe for canvas export).
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

  let img;
  if (import.meta.env.DEV) {
    const res = await fetch(toTraitsProxyUrl(assetUrl));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    img = await imageFromBlob(await res.blob());
  } else {
    img = await loadExportImageOpaque(assetUrl);
  }

  cache.set(assetUrl, img);
  return img;
}
