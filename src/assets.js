/**
 * Remote assets: CDN, object storage, or IPFS (via HTTPS gateway).
 *
 * Option A — full base URL (CDN / custom IPFS gateway path):
 *   VITE_ASSETS_BASE_URL=https://gateway.pinata.cloud/ipfs/QmYourFolderCid
 *
 * Option B — IPFS folder CID + gateway (app builds the URL):
 *   VITE_IPFS_CID=QmYourFolderCid
 *   VITE_IPFS_GATEWAY=https://w3s.link
 *
 * Empty = same origin (`/traits/...` from public/ or dist/).
 *
 * Note: browsers cannot load `ipfs://` directly — always use an HTTPS gateway.
 * Download PNG needs CORS on the asset host (R2: scripts/r2-cors.json, IPFS: gateway with CORS).
 */

/** @type {string} */
const EXPLICIT_BASE = (import.meta.env.VITE_ASSETS_BASE_URL ?? "").trim().replace(/\/+$/, "");

/** @type {string} */
const IPFS_CID = (import.meta.env.VITE_IPFS_CID ?? "").trim();

/** @type {string} */
const IPFS_GATEWAY = (import.meta.env.VITE_IPFS_GATEWAY ?? "https://w3s.link")
  .trim()
  .replace(/\/+$/, "");

/**
 * @returns {string}
 */
function resolveAssetsBase() {
  if (EXPLICIT_BASE) return EXPLICIT_BASE;
  if (IPFS_CID) return `${IPFS_GATEWAY}/ipfs/${IPFS_CID}`;
  return "";
}

/** @type {string} */
export const ASSETS_BASE = resolveAssetsBase();

/** @returns {boolean} */
export function usesRemoteAssets() {
  return ASSETS_BASE.length > 0;
}

/** @returns {boolean} */
export function usesIpfsAssets() {
  return !EXPLICIT_BASE && IPFS_CID.length > 0;
}

/**
 * @param {string} path
 * @returns {string}
 */
function joinAssetPath(path) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!ASSETS_BASE) return clean;
  return `${ASSETS_BASE}${clean}`;
}

/** @returns {string} */
export function traitsManifestUrl() {
  return joinAssetPath("/traits/manifest.json");
}

/** @returns {string} */
export function traitsScanUrl() {
  return joinAssetPath("/traits/_scan.json");
}

/**
 * @param {string} category
 * @param {string} filename
 * @returns {string}
 */
export function categoryAssetUrl(category, filename) {
  const name = filename.replace(/^\//, "");
  if (name.startsWith("http://") || name.startsWith("https://")) return name;
  if (name.startsWith("/")) return joinAssetPath(name);
  return joinAssetPath(`/traits/${category}/${name}`);
}

/**
 * @param {string} filename
 * @returns {string}
 */
export function stickerAssetUrl(filename) {
  return categoryAssetUrl("stickers", filename);
}

/**
 * Thumbnail path: `traits/<category>/thumbs/<file>` (falls back to full URL on 404).
 * @param {string} category
 * @param {string} fullUrl
 * @returns {string}
 */
export function categoryThumbUrl(category, fullUrl) {
  const marker = `/traits/${category}/`;
  const idx = fullUrl.indexOf(marker);
  if (idx === -1) return fullUrl;
  const prefix = fullUrl.slice(0, idx + marker.length);
  const file = fullUrl.slice(idx + marker.length);
  if (file.startsWith("thumbs/")) return fullUrl;
  return `${prefix}thumbs/${file}`;
}

/**
 * @param {string} fullUrl
 * @returns {string}
 */
export function stickerThumbUrl(fullUrl) {
  return categoryThumbUrl("stickers", fullUrl);
}

/**
 * Cross-origin images need CORS on the gateway for canvas export (Download PNG).
 * @param {string} url
 * @returns {boolean}
 */
export function assetNeedsCrossOrigin(url) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  try {
    return new URL(url).origin !== window.location.origin;
  } catch {
    return false;
  }
}
