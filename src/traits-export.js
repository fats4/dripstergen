import { assetPathFromUrl, toTraitsProxyUrl, usesRemoteAssets } from "./assets.js";
import { getCachedImage, LruImageCache } from "./image-cache.js";

/** @type {string | null} */
let resolvedSwFile = null;

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
 * @returns {Promise<string>}
 */
async function resolveSwFilename() {
  if (resolvedSwFile) return resolvedSwFile;
  const res = await fetch(`${import.meta.env.BASE_URL}traits-sw.json`, { cache: "no-store" });
  if (!res.ok) throw new Error("traits-sw.json missing");
  const data = await res.json();
  if (!data?.url || typeof data.url !== "string") throw new Error("traits-sw.json invalid");
  resolvedSwFile = data.url;
  return resolvedSwFile;
}

/**
 * Service worker fetch bypasses page CORS — required for export on driplab.mondrips.com.
 * @returns {Promise<void>}
 */
export async function ensureExportWorkerReady() {
  if (!usesRemoteAssets() || !("serviceWorker" in navigator) || import.meta.env.DEV) return;

  const swFile = await resolveSwFilename();
  const swUrl = new URL(swFile, `${window.location.origin}${import.meta.env.BASE_URL}`).href;

  const regs = await navigator.serviceWorker.getRegistrations();
  for (const reg of regs) {
    const script = reg.active?.scriptURL ?? reg.installing?.scriptURL ?? reg.waiting?.scriptURL ?? "";
    if (script.includes("sw-traits-proxy") && !script.endsWith(swFile)) {
      await reg.unregister();
    }
  }

  let reg = await navigator.serviceWorker.getRegistration(swUrl);
  if (!reg) {
    reg = await navigator.serviceWorker.register(swUrl);
  }

  await navigator.serviceWorker.ready;

  if (!reg.active) {
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("service worker not active")), 8000);
      const worker = reg.installing ?? reg.waiting;
      if (!worker) {
        window.clearTimeout(timer);
        resolve();
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") {
          window.clearTimeout(timer);
          resolve();
        }
      });
    });
  }
}

/**
 * @param {string} path e.g. /traits/skin/Basic.webp
 * @returns {Promise<Blob>}
 */
async function fetchTraitBlobViaServiceWorker(path) {
  await ensureExportWorkerReady();
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
