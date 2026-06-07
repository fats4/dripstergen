import { usesRemoteAssets } from "./assets.js";
import { getCachedImage, loadImageElementOnce, LruImageCache } from "./image-cache.js";

const CORS_SETUP_MSG =
  "Download butuh CORS di assets.mondrips.com.\n\n" +
  "Cloudflare Dashboard → Rules → Transform Rules → Modify Response Header:\n" +
  "  If hostname = assets.mondrips.com\n" +
  "  Set Access-Control-Allow-Origin = https://driplab.mondrips.com\n" +
  "  Set Access-Control-Allow-Methods = GET, HEAD\n\n" +
  "Atau deploy workers/assets-cors.js ke assets.mondrips.com\n" +
  "(lihat juga scripts/r2-cors.json untuk R2 bucket CORS).";

/**
 * Load trait image for PNG export — requires CORS on the asset host.
 * @param {LruImageCache} cache
 * @param {string} assetUrl
 * @returns {Promise<HTMLImageElement>}
 */
export async function loadExportTraitImage(cache, assetUrl) {
  if (!usesRemoteAssets()) {
    const hit = cache.get(assetUrl);
    if (hit?.naturalWidth) return hit;
    return getCachedImage(cache, assetUrl);
  }

  // Always fetch with CORS for export — preview cache may hold non-CORS (tainted) images.
  try {
    const img = await loadImageElementOnce(assetUrl, true);
    cache.set(assetUrl, img);
    return img;
  } catch {
    throw new Error("cors_required");
  }
}

/** @returns {string} */
export function exportCorsSetupMessage() {
  return CORS_SETUP_MSG;
}
