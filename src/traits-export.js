import { assetPathFromUrl, toTraitsProxyUrl, usesRemoteAssets } from "./assets.js";
import { getCachedImage, LruImageCache } from "./image-cache.js";

/**
 * @param {string} path e.g. /traits/skin/Basic.webp
 * @returns {Promise<Blob>}
 */
async function fetchTraitBlobViaServiceWorker(path) {
  const reg = await navigator.serviceWorker.ready;
  const sw = reg.active;
  if (!sw) throw new Error("service worker not active");

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => reject(new Error("service worker timeout")), 20000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const data = event.data;
      if (!data || data.error) {
        reject(new Error(data?.error ?? "fetch failed"));
        return;
      }
      resolve(new Blob([data.buffer], { type: data.mime || "application/octet-stream" }));
    };
    sw.postMessage({ type: "FETCH_TRAIT", path }, [channel.port2]);
  });
}

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
 * Load trait image for PNG export (same-origin blob — safe for canvas export).
 * @param {LruImageCache} cache
 * @param {string} assetUrl
 * @returns {Promise<HTMLImageElement>}
 */
export async function loadExportTraitImage(cache, assetUrl) {
  const hit = cache.get(assetUrl);
  if (hit) return hit;

  if (!usesRemoteAssets()) {
    return getCachedImage(cache, assetUrl);
  }

  const path = assetPathFromUrl(assetUrl);
  if (!path) throw new Error("invalid asset url");

  let blob;
  if (import.meta.env.DEV) {
    const res = await fetch(toTraitsProxyUrl(assetUrl));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } else {
    blob = await fetchTraitBlobViaServiceWorker(path);
  }

  const img = await imageFromBlob(blob);
  cache.set(assetUrl, img);
  return img;
}

/**
 * @returns {Promise<void>}
 */
export async function registerTraitsExportWorker() {
  if (!usesRemoteAssets() || !("serviceWorker" in navigator) || import.meta.env.DEV) return;
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw-traits-proxy.js`);
  } catch (err) {
    console.warn("[traits-export] service worker registration failed", err);
  }
}
