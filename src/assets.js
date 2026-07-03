/**
 * Remote assets via object storage / CDN (Cloudflare R2).
 *
 *   VITE_ASSETS_BASE_URL=https://assets.mondrips.com
 *
 * Empty = same origin `/traits/...` via R2 dev proxy when `VITE_R2_DEV_TRAITS=true`.
 *
 */

const TRAITS_PROXY_PREFIX = "/traits-proxy";

/** @type {string} */
const EXPLICIT_BASE = (import.meta.env.VITE_ASSETS_BASE_URL ?? "").trim().replace(/\/+$/, "");

/** @type {string} */
export const ASSETS_BASE = EXPLICIT_BASE;

/** @returns {boolean} */
function usesR2DevTraits() {
  const flag = (import.meta.env.VITE_R2_DEV_TRAITS ?? "").trim().toLowerCase();
  return import.meta.env.DEV && flag !== "false" && flag !== "0" && flag.length > 0;
}

/** @returns {boolean} */
export function usesRemoteAssets() {
  return ASSETS_BASE.length > 0 || usesR2DevTraits();
}

/**
 * In dev with remote assets, use same-origin `/traits/*` (Vite r2-dev-proxy).
 * Works on LAN IP / phone — no CDN CORS issues.
 * @param {string} relPath e.g. `/traits/clothes/foo.webp`
 * @returns {string}
 */
function resolveTraitAssetPath(relPath) {
  const clean = relPath.startsWith("/") ? relPath : `/${relPath}`;
  if (import.meta.env.DEV && (ASSETS_BASE || usesR2DevTraits())) {
    return clean;
  }
  return joinAssetPath(clean);
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

/**
 * Trait catalog JSON is baked into Pages deploy (see deploy.yml).
 * Cross-origin fetch to R2 needs CORS; same-origin avoids an extra bucket setting.
 * @returns {string}
 */
export function traitsManifestUrl() {
  if (usesRemoteAssets()) return "/traits/manifest.json";
  return joinAssetPath("/traits/manifest.json");
}

/** @returns {string} */
export function traitsScanUrl() {
  if (usesRemoteAssets()) return "/traits/_scan.json";
  return joinAssetPath("/traits/_scan.json");
}

/** @returns {string} */
export function traitsMoniggaStickersUrl() {
  if (usesRemoteAssets()) return "/traits/_monigga-stickers.json";
  return joinAssetPath("/traits/_monigga-stickers.json");
}

/** @returns {string} */
export function traitsCollabUrl() {
  if (usesRemoteAssets()) return "/traits/_collab.json";
  return joinAssetPath("/traits/_collab.json");
}

/**
 * @param {string} category
 * @param {string} filename
 * @returns {string}
 */
export function categoryAssetUrl(category, filename) {
  const name = filename.replace(/^\//, "");
  if (name.startsWith("http://") || name.startsWith("https://")) return name;
  if (name.startsWith("/")) return resolveTraitAssetPath(name);
  return resolveTraitAssetPath(`/traits/${category}/${name}`);
}

/**
 * Same-origin proxy path — for canvas export only (service worker fetches from R2).
 * @param {string} assetUrl
 * @returns {string}
 */
export function toTraitsProxyUrl(assetUrl) {
  if (!usesRemoteAssets() || !assetUrl) return assetUrl;
  const path = assetPathFromUrl(assetUrl);
  return path ? `${TRAITS_PROXY_PREFIX}${path}` : assetUrl;
}

/**
 * @param {string} assetUrl
 * @returns {string | null}
 */
export function assetPathFromUrl(assetUrl) {
  if (!assetUrl) return null;
  const marker = "/traits/";
  const idx = assetUrl.indexOf(marker);
  if (idx === -1) return null;
  return assetUrl.slice(idx);
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
 * Cross-origin images need CORS on the asset host for canvas export (Download PNG).
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
