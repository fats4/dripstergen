import "./style.css";
import bundledCollabManifest from "./collab-manifest.json";
import bundledTraitLocks from "./trait-locks.json";
import {
  categoryAssetUrl,
  categoryThumbUrl,
  traitsManifestUrl,
  traitsScanUrl,
  traitsCollabUrl,
  traitsMoniggaStickersUrl,
  usesRemoteAssets,
  stickerThumbUrl,
} from "./assets.js";
import { getCachedImage, LruImageCache } from "./image-cache.js";
import { exportCorsSetupMessage, loadExportTraitImage } from "./traits-export.js";
import {
  CATEGORY_KEYS,
  COMPOSITE_ORDER,
  CUSTOM_OVERLAY_STORAGE_KEY,
  PICKER_TAB_KEYS,
  PICKER_TAB_LABELS,
  COLLAB_LAYER_KEYS,
  isCollabTraitsEnabled,
  isCollabCategoryEnabled,
  isCollabSkinEnabled,
  STICKERS_TAB,
  STICKER_SOURCE_KEYS,
  STICKER_SOURCE_LABELS,
  getStickerSourceKeys,
  isMoniggaStickersEnabled,
  defaultCollabSelection,
  clampStickerOverlay,
  CUSTOM_BG_COLOR_STORAGE_KEY,
  defaultCustomBackgroundColor,
  defaultSelection,
  defaultStickerOverlay,
  normalizeHexColor,
  parseStoredStickerOverlay,
  selectionFromSeed,
  selectionToSeed,
} from "./state.js";

/** @typedef {import('./state.js').CategoryKey} CategoryKey */
/** @typedef {import('./state.js').PickerTabKey} PickerTabKey */
/** @typedef {import('./state.js').Selection} Selection */
/** @typedef {import('./state.js').Counts} Counts */
/** @typedef {import('./state.js').StickerOverlay} StickerOverlay */
/** @typedef {import('./state.js').StickerSourceKey} StickerSourceKey */
/** @typedef {import('./state.js').CollabSelection} CollabSelection */
/** @typedef {import('./state.js').CollabPartnerKey} CollabPartnerKey */

/** Internal preview & download resolution — higher = sharper (assets ideally ≥ this) */
const PREVIEW = 1024;
/** Logical thumbnail size (px); larger canvas buffer for Retina + wide grid cells */
const THUMB = 96;
/** Tab thumb only — room for `.thumb-collab-brand` (preview composite unchanged) */
const COLLAB_THUMB_BRAND_INSET = THUMB * 0.19;

/** @typedef {'default' | 'collab-clothes'} ThumbLayout */
const IMAGE_CACHE_MAX = 300;
const IMAGE_CACHE_MAX_MOBILE = 12;
const PREVIEW_MOBILE = 512;
/** Painted thumb bitmaps — instant restore when virtual scroll remounts cells */
const THUMB_PAINT_CACHE_MAX = 600;
const THUMB_PAINT_CACHE_MAX_MOBILE = 0;
/** Above this count, thumb grid uses virtual scroll (for 3000+ assets) */
const VIRTUAL_THUMB_THRESHOLD = 60;
/** Mobile: virtual scroll only for huge sticker lists; skin/clothes use a simple lazy grid */
const VIRTUAL_THUMB_THRESHOLD_MOBILE = 100;
const THUMB_HYDRATE_MAX = 6;
const THUMB_HYDRATE_MAX_MOBILE = 2;
const PICKER_TAP_GUARD_MS = 120;
const MOBILE_VIRTUAL_SCROLL_MS = 140;

const imageCache = new LruImageCache(IMAGE_CACHE_MAX);
/** Fresh CORS-only images for PNG export — never shared with preview cache. */
const exportImageCache = new LruImageCache(IMAGE_CACHE_MAX);

/** @type {Map<string, { sx: number; sy: number; sw: number; sh: number } | null>} */
const thumbBoundsCache = new Map();

/** @type {Map<string, HTMLCanvasElement>} */
const thumbPaintCache = new Map();

const app = document.querySelector("#app");
if (!app) throw new Error("#app is missing");

app.innerHTML = `
<div class="app">
  <header class="header">
    <h1 class="title">
      <img class="site-logo site-logo--light" src="/driplab-logo-black.png" alt="DRIP[lab]" width="1024" height="115" />
      <img class="site-logo site-logo--dark" src="/driplab-logo-white.png" alt="DRIP[lab]" width="1024" height="116" />
    </h1>
    <p class="subtitle">powered by mondrips</p>
  </header>

  <main class="main">
    <section class="panel panel--preview" aria-label="Preview">
      <div class="preview-stack">
        <div class="preview-wrap" id="previewWrap">
          <canvas id="preview" width="${PREVIEW}" height="${PREVIEW}"></canvas>
          <p class="custom-overlay-hint" id="customOverlayHint" hidden>
            Drag to move · Shift+scroll to rotate
          </p>
        </div>
        <div class="sticker-controls" id="stickerControls" role="group" aria-label="Sticker controls" hidden>
          <label class="custom-overlay-scale">
            <span class="custom-overlay-scale__label">Size</span>
            <input
              type="range"
              id="customOverlayScale"
              min="12"
              max="100"
              value="45"
              aria-label="Sticker size"
            />
          </label>
          <label class="custom-overlay-scale">
            <span class="custom-overlay-scale__label">Rotate</span>
            <input
              type="range"
              id="stickerRotation"
              min="0"
              max="360"
              value="0"
              aria-label="Sticker rotation in degrees"
            />
            <span class="sticker-rotation-value" id="stickerRotationValue" aria-hidden="true">0°</span>
          </label>
          <button type="button" class="btn btn--ghost btn--compact" id="btnCustomReset">
            Reset sticker
          </button>
        </div>
        <div class="actions" role="toolbar" aria-label="Preview actions">
          <div class="seed-group">
            <input
              type="text"
              id="seedInput"
              class="seed-input"
              inputmode="numeric"
              autocomplete="off"
              aria-label="Combination id"
            />
            <button type="button" class="seed-search" id="btnSeedApply" aria-label="Apply id">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm0-2a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z" fill="currentColor" />
                <path d="M20 20 15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <button type="button" class="btn btn--ghost" id="btnRandom">
            <svg class="btn__icon btn__icon--dice" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="5" width="14" height="14" rx="3" stroke="currentColor" stroke-width="2" />
              <circle cx="9.5" cy="9.5" r="1.75" fill="currentColor" />
              <circle cx="14.5" cy="9.5" r="1.75" fill="currentColor" />
              <circle cx="12" cy="12" r="1.75" fill="currentColor" />
              <circle cx="9.5" cy="14.5" r="1.75" fill="currentColor" />
              <circle cx="14.5" cy="14.5" r="1.75" fill="currentColor" />
            </svg>
            Randomise
          </button>
          <button type="button" class="btn btn--ghost" id="btnReset">
            <svg class="btn__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M3 3v5h5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Reset
          </button>
          <button type="button" class="btn btn--primary" id="btnDownload">
            <svg class="btn__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Download
          </button>
        </div>
      </div>
    </section>

    <section class="panel panel--picker" aria-label="Asset picker">
      <div class="top-row">
        <div class="collection-switch" role="group" aria-label="Theme switch">
          <span class="collection-name collection-name--active" id="modeLightLabel">mondrips</span>
          <button type="button" class="switch" id="themeSwitch" aria-label="Toggle dark mode" aria-pressed="false">
            <span class="switch-knob"></span>
          </button>
          <span class="collection-name" id="modeDarkLabel">mondrips</span>
        </div>
      </div>
      <nav class="tabs" id="tabs" role="tablist"></nav>
      <nav class="sub-tabs sticker-sub-tabs" id="stickerSubTabs" role="tablist" hidden></nav>
      <div class="background-color-bar" id="backgroundColorBar" hidden>
        <div class="background-color-panel">
          <div class="background-color-panel__intro">
            <svg class="background-color-panel__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="5" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.75" />
              <circle cx="9.5" cy="9.5" r="1.5" fill="currentColor" />
              <circle cx="14.5" cy="9.5" r="1.5" fill="currentColor" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <circle cx="9.5" cy="14.5" r="1.5" fill="currentColor" />
              <circle cx="14.5" cy="14.5" r="1.5" fill="currentColor" />
            </svg>
            <div>
              <p class="background-color-panel__title">Custom background color</p>
              <p class="background-color-panel__hint">Pick any color below, or tap the <strong>Custom</strong> tile in the grid</p>
            </div>
          </div>
          <div class="background-color-panel__controls">
            <label class="background-color-swatch" title="Open color picker">
              <span class="background-color-swatch__label">Color</span>
              <input type="color" id="backgroundColorInput" value="#6366f1" aria-label="Pick background color" />
            </label>
            <input
              type="text"
              class="background-color-hex"
              id="backgroundColorHex"
              value="#6366f1"
              maxlength="7"
              spellcheck="false"
              autocomplete="off"
              aria-label="Background color hex code"
              placeholder="#RRGGBB"
            />
          </div>
        </div>
      </div>
      <div class="sticker-search-bar" id="stickerSearchBar" hidden>
        <div class="seed-group sticker-search-group">
          <input
            type="text"
            id="stickerSearchInput"
            class="seed-input sticker-search-input"
            inputmode="numeric"
            placeholder="Sticker ID"
            spellcheck="false"
            autocomplete="off"
            aria-label="Search sticker by id"
          />
          <button type="button" class="seed-search" id="btnStickerSearchApply" aria-label="Find sticker">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm0-2a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z" fill="currentColor" />
              <path d="M20 20 15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <p class="sticker-search-feedback" id="stickerSearchFeedback" hidden></p>
      </div>
      <div class="thumb-grid" id="thumbGrid"></div>
    </section>
  </main>
</div>
`;

/** @type {Record<CategoryKey, string[]>} */
const traitCatalog = {
  background: [],
  frame: [],
  accessories: [],
  clothes: [],
  glasses: [],
  hat: [],
  skin: [],
};

/** @type {Record<StickerSourceKey, string[]>} */
const stickerCatalogBySource = {
  skrumpeys: [],
  monigga: [],
};

/** @type {Record<StickerSourceKey, Map<string, number>>} */
const stickerIdToPickerIndexBySource = {
  skrumpeys: new Map(),
  monigga: new Map(),
};

/** Scan/manifest category per sticker sub-tab */
const STICKER_SOURCE_SCAN_KEY = {
  skrumpeys: "stickers",
  monigga: "monigga",
};

/** @type {CollabPartnerKey[]} */
let collabPartnerKeys = [];

/** @type {Record<string, import('./state.js').CollabTraitLockRule[]>} */
let collabTraitLocks = {};
/** @type {import('./state.js').CollabTraitLockRule[]} */
const globalTraitLocks = Array.isArray(bundledTraitLocks) ? bundledTraitLocks : [];

/** @type {Record<string, { label: string; accent: string; skin: string[]; frame: string[]; clothes: string[]; hat: string[]; accessories: string[] }>} */
let collabCatalog = {};

/** @type {Record<CategoryKey, Set<string>>} */
const collabFilenameSet = {
  background: new Set(),
  frame: new Set(),
  accessories: new Set(),
  clothes: new Set(),
  glasses: new Set(),
  hat: new Set(),
  skin: new Set(),
};

/**
 * @typedef {{ collabId: CollabPartnerKey; category: CategoryKey; index: number; url: string; label: string }} CollabPickerEntry
 * @typedef {{ kind: "empty" }} EmptyPickerEntry
 * @typedef {{ kind: "regular"; index: number }} RegularPickerEntry
 * @typedef {{ kind: "collab" } & CollabPickerEntry} CollabThumbEntry
 * @typedef {EmptyPickerEntry | RegularPickerEntry | CollabThumbEntry} CategoryPickerEntry
 */

/** From `src/traits/<category>/*` — bundled by Vite (`?url` = stable URL string) */
const traitGlobModules = import.meta.glob("./traits/**/*.{png,webp,jpg,jpeg,svg}", {
  eager: true,
  query: "?url",
  import: "default",
});

let thumbRenderToken = 0;
let thumbScrollRaf = 0;
let thumbRenderScheduleRaf = 0;
let previewRenderToken = 0;
let lastPickerInteractionAt = 0;
let thumbHydrateActive = 0;
/** @type {Array<() => Promise<void>>} */
const thumbHydrateQueue = [];
/** @type {IntersectionObserver | null} */
let thumbImgObserver = null;
let lastVirtualScrollAt = 0;

/** @returns {boolean} */
function isMobilePickerDevice() {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches ||
    window.innerWidth < 768
  );
}

/** @returns {number} Preview canvas backing store (export stays at PREVIEW). */
function previewPixelSize() {
  return isMobilePickerDevice() ? PREVIEW_MOBILE : PREVIEW;
}

function syncPreviewCanvasBackingStore() {
  const px = previewPixelSize();
  if (previewCanvas.width !== px) {
    previewCanvas.width = px;
    previewCanvas.height = px;
  }
}

/** Mobile uses lazy <img> thumbs — avoids hundreds of large canvases (Safari OOM). */
function useSimpleMobileThumbs() {
  return isMobilePickerDevice();
}

/** @returns {number} */
function effectiveVirtualThreshold() {
  return isMobilePickerDevice() ? VIRTUAL_THUMB_THRESHOLD_MOBILE : VIRTUAL_THUMB_THRESHOLD;
}

/** @returns {boolean} */
function consumePickerInteraction() {
  const gap = isMobilePickerDevice() ? PICKER_TAP_GUARD_MS : 0;
  if (gap <= 0) return true;
  const now = performance.now();
  if (now - lastPickerInteractionAt < gap) return false;
  lastPickerInteractionAt = now;
  return true;
}

function cancelThumbHydrateQueue() {
  thumbHydrateQueue.length = 0;
}

function drainThumbHydrateQueue() {
  const max = isMobilePickerDevice() ? THUMB_HYDRATE_MAX_MOBILE : THUMB_HYDRATE_MAX;
  while (thumbHydrateActive < max && thumbHydrateQueue.length > 0) {
    const job = thumbHydrateQueue.shift();
    if (!job) break;
    thumbHydrateActive += 1;
    void job().finally(() => {
      thumbHydrateActive -= 1;
      drainThumbHydrateQueue();
    });
  }
}

/**
 * @param {() => Promise<void>} job
 */
function scheduleHydrateThumb(job) {
  if (useSimpleMobileThumbs()) return;
  thumbHydrateQueue.push(job);
  drainThumbHydrateQueue();
}

/** @returns {number} */
function maxThumbPaintCacheEntries() {
  return isMobilePickerDevice() ? THUMB_PAINT_CACHE_MAX_MOBILE : THUMB_PAINT_CACHE_MAX;
}

function trimImageCacheForDevice() {
  const cap = isMobilePickerDevice() ? IMAGE_CACHE_MAX_MOBILE : IMAGE_CACHE_MAX;
  while (imageCache.map.size > cap) {
    const oldest = imageCache.map.keys().next().value;
    if (oldest) imageCache.map.delete(oldest);
  }
}

function disconnectThumbImgObserver() {
  thumbImgObserver?.disconnect();
  thumbImgObserver = null;
}

function ensureThumbImgObserver() {
  if (!useSimpleMobileThumbs() || !thumbGrid) return null;
  if (thumbImgObserver) return thumbImgObserver;
  thumbImgObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        if (!(el instanceof HTMLImageElement)) continue;
        const src = el.dataset.src;
        if (src && el.getAttribute("src") !== src) el.src = src;
        thumbImgObserver?.unobserve(el);
      }
    },
    { root: thumbGrid, rootMargin: "80px 0px", threshold: 0.01 },
  );
  return thumbImgObserver;
}

/**
 * Smaller thumb assets for picker on mobile (full layer still used in preview).
 * @param {CategoryKey | typeof STICKERS_TAB | null} cat
 * @param {string} fullUrl
 */
function resolvePickerThumbUrl(cat, fullUrl) {
  if (!fullUrl || !useSimpleMobileThumbs()) return fullUrl;
  if (cat === STICKERS_TAB) return stickerThumbUrl(fullUrl);
  if (cat) return categoryThumbUrl(cat, fullUrl);
  return fullUrl;
}

/**
 * @param {string} fullUrl
 * @param {CategoryKey | typeof STICKERS_TAB | null} [cat]
 * @returns {HTMLImageElement}
 */
function createLazyThumbImage(fullUrl, cat = null) {
  const img = document.createElement("img");
  img.className = "thumb-img";
  img.alt = "";
  img.decoding = "async";
  const displayUrl = resolvePickerThumbUrl(cat, fullUrl);
  if (useSimpleMobileThumbs()) {
    img.loading = "lazy";
    img.src = displayUrl;
    if (displayUrl !== fullUrl) {
      img.addEventListener(
        "error",
        () => {
          if (fullUrl && img.src !== fullUrl) img.src = fullUrl;
        },
        { once: true },
      );
    }
  } else {
    img.loading = "lazy";
    img.src = displayUrl;
  }
  return img;
}

function releaseMobilePickerMemory() {
  if (!isMobilePickerDevice()) return;
  thumbPaintCache.clear();
  if (thumbBoundsCache.size > 48) thumbBoundsCache.clear();
}

function scheduleRenderThumbs() {
  cancelAnimationFrame(thumbRenderScheduleRaf);
  const run = () => {
    thumbRenderScheduleRaf = 0;
    renderThumbs();
  };
  if (isMobilePickerDevice()) {
    thumbRenderScheduleRaf = requestAnimationFrame(() => {
      thumbRenderScheduleRaf = requestAnimationFrame(run);
    });
    return;
  }
  thumbRenderScheduleRaf = requestAnimationFrame(run);
}

/** @type {{ token: number; count: number; cols: number; startRow: number; endRow: number } | null} */
let virtualThumbMount = null;

/**
 * @param {unknown} mod
 * @returns {string}
 */
function moduleToUrl(mod) {
  if (typeof mod === "string") return mod;
  if (mod && typeof mod === "object" && "default" in mod) {
    const d = /** @type {{ default: unknown }} */ (mod).default;
    if (typeof d === "string") return d;
  }
  return "";
}

/**
 * If both foo.png and foo.webp exist, pick one URL (prefer .webp).
 * @param {string[]} urls
 * @returns {string[]}
 */
function dedupeTraitUrls(urls) {
  /** @param {string} u */
  function priority(u) {
    const l = u.toLowerCase().split("?")[0];
    if (l.endsWith(".webp")) return 0;
    if (l.endsWith(".png")) return 1;
    if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return 2;
    if (l.endsWith(".svg")) return 3;
    return 4;
  }
  /** @param {string} url */
  function basenameKey(url) {
    const file = url.split("/").pop()?.split("?")[0] ?? "";
    return file.replace(/\.(webp|png|jpe?g|svg)$/i, "");
  }
  /** @type {Map<string, string>} */
  const byBase = new Map();
  for (const url of urls) {
    const key = basenameKey(url);
    const prev = byBase.get(key);
    if (!prev || priority(url) < priority(prev)) {
      byBase.set(key, url);
    }
  }
  return [...byBase.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Collect URLs per category: glob `src/traits` + optional `public/traits/manifest.json`
 * (manifest lists filenames per category, served from `/traits/<category>/...`).
 * @returns {Promise<void>}
 */
async function loadTraitCatalog() {
  /** @type {Record<CategoryKey, Set<string>>} */
  const byCat = {
    background: new Set(),
    frame: new Set(),
    accessories: new Set(),
    clothes: new Set(),
    glasses: new Set(),
    hat: new Set(),
    skin: new Set(),
  };

  if (!usesRemoteAssets()) {
    const sortedPaths = Object.keys(traitGlobModules).sort();
    for (const p of sortedPaths) {
      const m = p.match(/^\.\/traits\/([^/]+)\/[^/]+$/i);
      if (!m) continue;
      const cat = /** @type {CategoryKey | undefined} */ (m[1]);
      if (!cat || !CATEGORY_KEYS.includes(cat)) continue;
      const raw = traitGlobModules[p];
      const url = typeof raw === "string" ? raw : moduleToUrl(raw);
      if (url) byCat[cat].add(url);
    }
  }

  try {
    const res = await fetch(traitsManifestUrl(), { cache: usesRemoteAssets() ? "default" : "no-store" });
    if (res.ok) {
      /** @type {Partial<Record<string, unknown>>} */
      const manifest = await res.json();
      for (const key of CATEGORY_KEYS) {
        const list = manifest[key];
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          if (typeof entry !== "string" || !entry) continue;
          byCat[key].add(categoryAssetUrl(key, entry));
        }
      }
    }
  } catch {
    /* manifest optional */
  }

  try {
    const res = await fetch(traitsScanUrl(), { cache: usesRemoteAssets() ? "default" : "no-store" });
    if (res.ok) {
      /** @type {Partial<Record<string, unknown>>} */
      const scan = await res.json();
      for (const key of CATEGORY_KEYS) {
        const list = scan[key];
        if (!Array.isArray(list)) continue;
        for (const name of list) {
          if (typeof name !== "string" || !name) continue;
          byCat[key].add(categoryAssetUrl(key, name));
        }
      }
    }
  } catch {
    /* optional */
  }

  for (const key of CATEGORY_KEYS) {
    traitCatalog[key] = dedupeTraitUrls([...byCat[key]]);
  }

  await applyCollabManifest(traitCatalog);
}

/**
 * @param {string} url
 * @returns {string}
 */
function urlBasename(url) {
  return (url.split("/").pop() ?? "").split("?")[0];
}

/**
 * Deep-merge collab partner defs (remote must not drop bundled trait categories).
 * @param {Record<string, import('./state.js').CollabPartnerDef>} base
 * @param {Record<string, import('./state.js').CollabPartnerDef>} patch
 * @returns {Record<string, import('./state.js').CollabPartnerDef>}
 */
function mergeCollabManifests(base, patch) {
  /** @type {Record<string, import('./state.js').CollabPartnerDef>} */
  const out = { ...base };
  for (const [id, remote] of Object.entries(patch)) {
    if (!remote || typeof remote !== "object") continue;
    const local = base[id];
    if (!local) {
      out[id] = remote;
      continue;
    }
    out[id] = {
      label: typeof remote.label === "string" ? remote.label : local.label,
      accent: typeof remote.accent === "string" ? remote.accent : local.accent,
      traits: { ...local.traits, ...remote.traits },
      traitLocks: Array.isArray(remote.traitLocks) ? remote.traitLocks : local.traitLocks,
    };
  }
  return out;
}

/**
 * Load collab manifest, build collab catalogs, and strip collab files from regular trait grids.
 * @param {Record<CategoryKey, string[]>} catalog
 */
async function applyCollabManifest(catalog) {
  collabPartnerKeys = [];
  collabCatalog = {};
  collabTraitLocks = {};
  for (const key of CATEGORY_KEYS) collabFilenameSet[key].clear();
  if (!isCollabSkinEnabled() && !isCollabTraitsEnabled()) {
    collabSelection = defaultCollabSelection();
  } else if (!isCollabSkinEnabled()) {
    collabSelection = withoutCollabCategory(collabSelection, "skin");
  } else if (!isCollabTraitsEnabled()) {
    let next = { ...collabSelection, partner: { ...collabSelection.partner } };
    for (const cat of COLLAB_LAYER_KEYS) {
      if (cat === "skin") continue;
      next = withoutCollabCategory(next, cat);
    }
    collabSelection = next;
  }

  /** @type {Record<string, import('./state.js').CollabPartnerDef>} */
  let manifest = { ...bundledCollabManifest };
  const collabUrls =
    import.meta.env.DEV && usesRemoteAssets()
      ? ["/traits/_collab.json", traitsCollabUrl()]
      : usesRemoteAssets()
        ? [traitsCollabUrl(), "/traits/_collab.json"]
        : [traitsCollabUrl()];
  for (const url of collabUrls) {
    try {
      const res = await fetch(url, { cache: usesRemoteAssets() ? "default" : "no-store" });
      if (res.ok) {
        manifest = mergeCollabManifests(
          bundledCollabManifest,
          /** @type {Record<string, import('./state.js').CollabPartnerDef>} */ (
            await res.json()
          ),
        );
        break;
      }
    } catch {
      /* try next source */
    }
  }

  for (const [id, def] of Object.entries(manifest)) {
    if (!def || typeof def !== "object") continue;
    const label = typeof def.label === "string" ? def.label : id;
    const accent = typeof def.accent === "string" ? def.accent : "#a78bfa";
    /** @type {{ label: string; accent: string; skin: string[]; frame: string[]; clothes: string[]; hat: string[]; accessories: string[] }} */
    const partner = { label, accent, skin: [], frame: [], clothes: [], hat: [], accessories: [] };

    for (const cat of COLLAB_LAYER_KEYS) {
      const list = def.traits?.[cat];
      if (!Array.isArray(list)) continue;
      for (const file of list) {
        if (typeof file !== "string" || !file) continue;
        // Always use the collab manifest category path (not a duplicate in clothes/, etc.).
        const url = categoryAssetUrl(cat, file);
        collabFilenameSet[cat].add(file.toLowerCase());
        if (isCollabCategoryEnabled(cat)) partner[cat].push(url);
      }
    }

    const hasPickerTraits = COLLAB_LAYER_KEYS.some((c) => partner[c].length > 0);
    if (!hasPickerTraits) continue;
    collabCatalog[id] = partner;
    collabTraitLocks[id] = Array.isArray(def.traitLocks) ? def.traitLocks : [];
    collabPartnerKeys.push(/** @type {CollabPartnerKey} */ (id));
  }

  /** @type {Set<string>} */
  const allCollabFilenames = new Set();
  for (const cat of COLLAB_LAYER_KEYS) {
    for (const file of collabFilenameSet[cat]) allCollabFilenames.add(file);
  }
  if (allCollabFilenames.size > 0) {
    for (const key of CATEGORY_KEYS) {
      catalog[key] = catalog[key].filter(
        (url) => !allCollabFilenames.has(urlBasename(url).toLowerCase()),
      );
    }
  }
}

function isCollabSelectionEmpty(/** @type {CollabSelection} */ sel = collabSelection) {
  for (const cat of COLLAB_LAYER_KEYS) {
    if (sel[cat] > 0) return false;
  }
  return true;
}

/**
 * @param {CategoryKey} cat
 * @param {CollabSelection} [sel]
 * @returns {CollabPartnerKey | null}
 */
function collabPartnerFor(cat, sel = collabSelection) {
  if (!COLLAB_LAYER_KEYS.includes(cat)) return null;
  const partnerId = sel.partner?.[cat];
  if (!partnerId || !collabCatalog[partnerId]) return null;
  return /** @type {CollabPartnerKey} */ (partnerId);
}

/**
 * @param {CollabSelection} [sel]
 * @returns {CollabPartnerKey[]}
 */
function activeCollabPartners(sel = collabSelection) {
  /** @type {Set<CollabPartnerKey>} */
  const partners = new Set();
  for (const cat of COLLAB_LAYER_KEYS) {
    if (sel[cat] <= 0) continue;
    const partnerId = collabPartnerFor(cat, sel);
    if (partnerId) partners.add(partnerId);
  }
  return [...partners];
}

/**
 * @param {CollabSelection} sel
 * @param {CategoryKey} cat
 * @returns {CollabSelection}
 */
function withoutCollabCategory(sel, cat) {
  if (!COLLAB_LAYER_KEYS.includes(cat)) return sel;
  const partner = { ...sel.partner };
  delete partner[cat];
  return { ...sel, [cat]: 0, partner };
}

/**
 * @param {CategoryKey} cat
 * @returns {string | null}
 */
function activeCollabLayerUrl(cat) {
  const partnerId = collabPartnerFor(cat);
  if (!partnerId || collabSelection[cat] <= 0) return null;
  return collabFullUrl(partnerId, cat, collabSelection[cat]);
}

/**
 * @param {CategoryKey} cat
 * @returns {string | null}
 */
function getActiveCollabTraitFilename(cat) {
  const url = activeCollabLayerUrl(cat);
  return url ? urlBasename(url) : null;
}

/**
 * Active filename for a category (collab layer wins over regular catalog when both exist).
 * @param {CategoryKey} cat
 * @returns {string | null}
 */
function getActiveTraitFilename(cat) {
  if (COLLAB_LAYER_KEYS.includes(cat) && collabSelection[cat] > 0) {
    const collabFile = getActiveCollabTraitFilename(cat);
    if (collabFile) return collabFile;
  }
  if (selection[cat] <= 0) return null;
  const url = traitFullUrl(cat, selection[cat]);
  return url ? urlBasename(url) : null;
}

/**
 * @param {string | string[] | undefined} whenVal
 * @param {string | null} activeFile
 * @returns {boolean}
 */
function whenValueMatches(whenVal, activeFile) {
  if (!activeFile) return false;
  const allowed = Array.isArray(whenVal) ? whenVal : [whenVal];
  return allowed.some(
    (f) => typeof f === "string" && f && f.toLowerCase() === activeFile.toLowerCase(),
  );
}

/**
 * @param {import('./state.js').TraitLockWhen} when
 * @returns {boolean}
 */
function isTraitLockWhenActive(when) {
  for (const [whenCat, whenVal] of Object.entries(when)) {
    if (!whenVal || (typeof whenVal !== "string" && !Array.isArray(whenVal))) return false;
    const activeFile = getActiveTraitFilename(/** @type {CategoryKey} */ (whenCat));
    if (!whenValueMatches(whenVal, activeFile)) return false;
  }
  return true;
}

/**
 * @param {import('./state.js').CollabTraitLockRule[]} locks
 * @param {CategoryKey} cat
 * @param {string} entryFileLower
 * @returns {boolean}
 */
function isEntryBlockedByLockRules(locks, cat, entryFileLower) {
  for (const rule of locks) {
    if (!isTraitLockWhenActive(rule.when ?? {})) continue;
    const blocked = rule.block?.[cat];
    if (!Array.isArray(blocked)) continue;
    if (blocked.some((f) => typeof f === "string" && f.toLowerCase() === entryFileLower)) return true;
  }
  return false;
}

/**
 * @param {CategoryKey} cat
 * @param {CategoryPickerEntry} entry
 * @returns {string | null}
 */
function getCategoryEntryFilename(cat, entry) {
  if (entry.kind === "empty") return null;
  if (entry.kind === "collab") return urlBasename(entry.url);
  const url = traitFullUrl(cat, entry.index);
  return url ? urlBasename(url) : null;
}

/**
 * @param {CategoryKey} cat
 * @param {CategoryPickerEntry} entry
 * @returns {boolean}
 */
function isCategoryEntryLocked(cat, entry) {
  if (entry.kind === "empty") return false;
  const entryFile = getCategoryEntryFilename(cat, entry)?.toLowerCase();
  if (!entryFile) return false;

  if (isEntryBlockedByLockRules(globalTraitLocks, cat, entryFile)) return true;

  for (const partnerId of activeCollabPartners()) {
    const activeLocks = collabTraitLocks[partnerId];
    if (activeLocks?.length && isEntryBlockedByLockRules(activeLocks, cat, entryFile)) return true;
  }

  const partnerId = entry.kind === "collab" ? entry.collabId : collabPartnerFor(cat);
  const locks = partnerId ? collabTraitLocks[partnerId] : null;
  if (!locks?.length) return false;
  return isEntryBlockedByLockRules(locks, cat, entryFile);
}

/** @returns {boolean} */
function enforceTraitLocks() {
  let changed = false;
  /** @type {CollabSelection} */
  const nextCollab = { ...collabSelection, partner: { ...collabSelection.partner } };
  /** @type {Selection} */
  let nextSelection = { ...selection };

  for (const cat of COLLAB_LAYER_KEYS) {
    if (nextCollab[cat] <= 0) continue;
    const partnerId = collabPartnerFor(cat, nextCollab);
    if (!partnerId) {
      nextCollab[cat] = 0;
      delete nextCollab.partner[cat];
      changed = true;
      continue;
    }
    const url = collabFullUrl(partnerId, cat, nextCollab[cat]);
    if (!url) {
      nextCollab[cat] = 0;
      delete nextCollab.partner[cat];
      changed = true;
      continue;
    }
    /** @type {CollabThumbEntry} */
    const entry = {
      kind: "collab",
      collabId: partnerId,
      category: cat,
      index: nextCollab[cat],
      url,
      label: urlBasename(url).replace(/\.[^.]+$/i, ""),
    };
    if (!isCategoryEntryLocked(cat, entry)) continue;
    nextCollab[cat] = 0;
    delete nextCollab.partner[cat];
    changed = true;
  }

  for (const cat of CATEGORY_KEYS) {
    if (nextSelection[cat] <= 0) continue;
    /** @type {CategoryPickerEntry} */
    const entry = { kind: "regular", index: nextSelection[cat] };
    if (!isCategoryEntryLocked(cat, entry)) continue;
    nextSelection[cat] = 0;
    changed = true;
  }

  if (!changed) return false;
  collabSelection = nextCollab;
  selection = nextSelection;
  for (const cat of COLLAB_LAYER_KEYS) {
    if (collabSelection[cat] === 0) selection = { ...selection, [cat]: 0 };
  }
  return true;
}

/**
 * @param {HTMLButtonElement} btn
 * @param {boolean} locked
 */
function applyThumbLockUi(btn, locked) {
  if (!locked) return;
  btn.classList.add("thumb--locked");
  btn.disabled = true;
  btn.setAttribute("aria-disabled", "true");
  const overlay = document.createElement("span");
  overlay.className = "thumb-lock-overlay";
  overlay.textContent = "locked";
  overlay.setAttribute("aria-hidden", "true");
  btn.appendChild(overlay);
}

/**
 * @param {CategoryKey} cat
 * @returns {CategoryPickerEntry[]}
 */
function getCategoryPickerEntries(cat) {
  /** @type {CategoryPickerEntry[]} */
  const entries = cat === "skin" ? [] : [{ kind: "empty" }];
  for (let i = 0; i < traitCatalog[cat].length; i++) {
    entries.push({ kind: "regular", index: i + 1 });
  }
  if (!COLLAB_LAYER_KEYS.includes(cat)) return entries;
  for (const partnerId of collabPartnerKeys) {
    const urls = collabCatalog[partnerId][cat];
    for (let i = 0; i < urls.length; i++) {
      entries.push({
        kind: "collab",
        collabId: partnerId,
        category: cat,
        index: i + 1,
        url: urls[i],
        label: urlBasename(urls[i]).replace(/\.[^.]+$/i, ""),
      });
    }
  }
  return entries;
}

/**
 * @param {CategoryKey} cat
 * @returns {number}
 */
function collabPickerIndex(cat) {
  if (!COLLAB_LAYER_KEYS.includes(cat)) return 0;
  return collabSelection[cat];
}

/**
 * @param {CategoryKey} cat
 * @param {CategoryPickerEntry} entry
 * @returns {boolean}
 */
function isCategoryEntrySelected(cat, entry) {
  if (entry.kind === "empty") {
    return selection[cat] === 0 && collabPickerIndex(cat) === 0;
  }
  if (entry.kind === "regular") {
    return selection[cat] === entry.index && collabPickerIndex(cat) === 0;
  }
  return collabPartnerFor(cat) === entry.collabId && collabSelection[cat] === entry.index;
}

/**
 * @param {CategoryKey} cat
 * @param {CategoryPickerEntry} entry
 */
async function onCategoryEntryClick(cat, entry) {
  if (!consumePickerInteraction()) return;
  if (entry.kind !== "empty" && isCategoryEntryLocked(cat, entry)) return;

  /** @type {string | null} */
  let prefetchUrl = null;
  if (entry.kind === "empty") {
    selection = { ...selection, [cat]: 0 };
    clearCollabForCategory(cat);
  } else if (entry.kind === "regular") {
    clearCollabForCategory(cat);
    selection = { ...selection, [cat]: entry.index };
    prefetchUrl = traitFullUrl(cat, entry.index);
  } else {
    const wasSelected = isCategoryEntrySelected(cat, entry);
    if (wasSelected) {
      collabSelection = withoutCollabCategory(collabSelection, cat);
      if (cat === "skin") {
        selection = { ...selection, skin: pickRandomSkinIndex() || 1 };
      }
    } else {
      collabSelection = {
        ...collabSelection,
        [cat]: entry.index,
        partner: { ...collabSelection.partner, [cat]: entry.collabId },
      };
      selection = { ...selection, [cat]: 0 };
      prefetchUrl = entry.url;
    }
  }
  const locksChanged = enforceTraitLocks();
  syncSeed();
  if (locksChanged) {
    scheduleRenderThumbs();
  } else {
    updatePickerSelectionHighlight(cat);
  }
  if (prefetchUrl && !isMobilePickerDevice()) {
    await getCachedImage(imageCache, prefetchUrl).catch(() => null);
  }
  await renderPreview(locksChanged ? null : cat);
}

/**
 * @param {CategoryKey} cat
 * @param {CategoryPickerEntry} entry
 * @param {boolean} selected
 * @param {number} token
 * @returns {HTMLButtonElement}
 */
function createCategoryThumbButton(cat, entry, selected, token) {
  /** @type {HTMLButtonElement} */
  let btn;
  if (entry.kind === "empty") {
    btn = createTraitThumbButton(cat, 0, selected, token);
  } else if (entry.kind === "regular") {
    btn = createTraitThumbButton(cat, entry.index, selected, token);
  } else {
    btn = createCollabThumbButton(entry, selected, token);
  }
  applyThumbLockUi(btn, isCategoryEntryLocked(cat, entry));
  return btn;
}

/**
 * @param {CollabPartnerKey} collabId
 * @param {CategoryKey} cat
 * @param {number} pickerIndex
 * @returns {string | null}
 */
function collabFullUrl(collabId, cat, pickerIndex) {
  if (pickerIndex <= 0) return null;
  return collabCatalog[collabId]?.[cat]?.[pickerIndex - 1] ?? null;
}

/**
 * @param {CategoryKey} cat
 * @param {number} selIndex
 * @returns {string | null}
 */
function resolveLayerUrl(cat, selIndex) {
  if (isCollabCategoryEnabled(cat)) {
    const url = activeCollabLayerUrl(cat);
    if (url) return url;
  }
  return traitFullUrl(cat, selIndex);
}

function clearCollabForCategory(cat) {
  if (!COLLAB_LAYER_KEYS.includes(cat)) return;
  collabSelection = withoutCollabCategory(collabSelection, cat);
}

/**
 * @param {CategoryKey} cat
 * @param {number} pickerIndex
 * @returns {string | null}
 */
function traitFullUrl(cat, pickerIndex) {
  if (pickerIndex <= 0) return null;
  return traitCatalog[cat][pickerIndex - 1] ?? null;
}

/**
 * @param {StickerSourceKey} source
 * @param {number} pickerIndex
 * @returns {string | null}
 */
function stickerFullUrl(source, pickerIndex) {
  if (pickerIndex <= 0) return null;
  return stickerCatalogBySource[source][pickerIndex - 1] ?? null;
}

/** @returns {string | null} */
function activeStickerFullUrl() {
  return stickerFullUrl(stickerOverlay.source, stickerOverlay.index);
}

/**
 * @param {StickerSourceKey} source
 * @param {string} filename
 * @returns {string}
 */
function stickerSourceAssetUrl(source, filename) {
  const category = STICKER_SOURCE_SCAN_KEY[source];
  return categoryAssetUrl(category, filename);
}

/**
 * @param {string} url
 * @returns {string}
 */
function stickerFilenameStem(url) {
  const name = url.split("/").pop() ?? "";
  return name.replace(/\.[^.]+$/i, "");
}

/**
 * @param {StickerSourceKey} source
 * @param {number} pickerIndex
 * @returns {string}
 */
function stickerIdFromPickerIndex(source, pickerIndex) {
  const url = stickerFullUrl(source, pickerIndex);
  return url ? stickerFilenameStem(url) : "";
}

/**
 * @param {string} query
 * @returns {string}
 */
function normalizeStickerIdQuery(query) {
  return query.trim().replace(/\.(png|webp|jpe?g|svg)$/i, "");
}

/**
 * @param {StickerSourceKey} source
 * @param {string} query
 * @returns {number | null}
 */
function findStickerPickerIndexById(source, query) {
  const id = normalizeStickerIdQuery(query);
  if (!id) return null;
  return stickerIdToPickerIndexBySource[source].get(id) ?? null;
}

function rebuildStickerIdMaps() {
  for (const source of STICKER_SOURCE_KEYS) {
    const map = stickerIdToPickerIndexBySource[source];
    map.clear();
    if (!getStickerSourceKeys().includes(source)) continue;
    const catalog = stickerCatalogBySource[source];
    for (let i = 0; i < catalog.length; i++) {
      const stem = stickerFilenameStem(catalog[i]);
      if (stem) map.set(stem, i + 1);
    }
  }
}

/**
 * @param {number} index
 */
function scrollThumbGridToIndex(index) {
  if (!thumbGrid || index < 0) return;
  requestAnimationFrame(() => {
    const { cols, rowHeight } = getThumbGridMetrics();
    const row = Math.floor(index / cols);
    thumbGrid.scrollTop = row * rowHeight;
    if (!thumbGrid.classList.contains("thumb-grid--virtual")) return;
    virtualThumbMount = null;
    if (isMobilePickerDevice()) {
      scheduleRenderThumbs();
      return;
    }
    thumbGrid.dispatchEvent(new Event("scroll"));
  });
}

/**
 * @param {string} message
 * @param {boolean} isError
 */
function setStickerSearchFeedback(message, isError = false) {
  if (!stickerSearchFeedback) return;
  if (!message) {
    stickerSearchFeedback.textContent = "";
    stickerSearchFeedback.toggleAttribute("hidden", true);
    stickerSearchFeedback.classList.remove("is-error");
    return;
  }
  stickerSearchFeedback.textContent = message;
  stickerSearchFeedback.toggleAttribute("hidden", false);
  stickerSearchFeedback.classList.toggle("is-error", isError);
}

/**
 * @returns {number}
 */
function getGridCols() {
  if (window.innerWidth <= 480) return 3;
  if (window.innerWidth <= 640) return 4;
  return 6;
}

/**
 * @returns {{ cols: number; gap: number; cell: number; rowHeight: number }}
 */
function getThumbGridMetrics() {
  const cols = getGridCols();
  const width = thumbGrid?.clientWidth || 300;
  let gap = 6;
  if (thumbGrid) {
    const style = getComputedStyle(thumbGrid);
    const parsed = Number.parseFloat(style.rowGap || style.gap);
    if (Number.isFinite(parsed)) gap = parsed;
  }
  let cell = (width - gap * (cols - 1)) / cols;
  const sample = thumbGrid?.querySelector(".thumb");
  if (sample) {
    const h = sample.getBoundingClientRect().height;
    if (h > 0) cell = h;
  }
  return { cols, gap, cell, rowHeight: cell + gap };
}

/**
 * @param {Selection} sel
 * @returns {Promise<void>}
 */
async function prefetchSelectionLayers(
  sel = selection,
  token = previewRenderToken,
  /** @type {CategoryKey | null} */ focusCat = null,
) {
  /** @type {readonly CategoryKey[]} */
  const keys =
    focusCat && isMobilePickerDevice()
      ? /** @type {CategoryKey[]} */ ([focusCat])
      : COMPOSITE_ORDER;
  /** @type {string[]} */
  const urls = [];
  for (const key of keys) {
    if (token !== previewRenderToken) return;
    if (key === "background" && isCustomBackgroundIndex(sel.background)) continue;
    const url = resolveLayerUrl(key, sel[key]);
    if (url) urls.push(url);
  }
  for (const url of urls) {
    if (token !== previewRenderToken) return;
    await getCachedImage(imageCache, url).catch(() => null);
  }
}

/**
 * @returns {Promise<void>}
 */
async function refreshActiveStickerImage() {
  const url = activeStickerFullUrl();
  if (!url) {
    activeStickerImage = null;
    return;
  }
  try {
    activeStickerImage = await getCachedImage(imageCache, url);
  } catch {
    activeStickerImage = null;
  }
}

function pickRandomSkinIndex() {
  const n = traitCatalog.skin.length;
  return n > 0 ? 1 + Math.floor(Math.random() * n) : 0;
}

function clampSelection() {
  const counts = getCounts();
  for (const key of CATEGORY_KEYS) {
    if (key === "skin" && traitCatalog.skin.length > 0) {
      const hasCollabSkin = isCollabSkinEnabled() && collabSelection.skin > 0 && collabPartnerFor("skin");
      if (hasCollabSkin) {
        selection[key] = 0;
      } else {
        selection[key] = Math.max(1, Math.min(selection[key], traitCatalog.skin.length));
      }
      continue;
    }
    let max = counts[key] - 1;
    if (key === "background" && !isCustomBackgroundIndex(selection.background)) {
      max = getBackgroundPickerCount() - 1;
    }
    selection[key] = Math.max(0, Math.min(selection[key], max));
  }
}

/** @type {Selection} */
let selection = defaultSelection();
/** @type {CollabSelection} */
let collabSelection = defaultCollabSelection();
/** @type {PickerTabKey} */
let activeTab = "skin";
/** @type {StickerSourceKey} */
let activeStickerSubTab = "skrumpeys";
/** @type {string} */
let customBackgroundColor = defaultCustomBackgroundColor();

/** @type {StickerOverlay} */
let stickerOverlay = defaultStickerOverlay();
/** @type {HTMLImageElement | null} */
let activeStickerImage = null;
let stickerDragging = false;

const previewCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("preview"));
const previewWrap = document.getElementById("previewWrap");
const previewCtx = previewCanvas.getContext("2d");
if (!previewCtx) throw new Error("2d context");

const tabsEl = document.getElementById("tabs");
const stickerSubTabsEl = document.getElementById("stickerSubTabs");
const backgroundColorBar = document.getElementById("backgroundColorBar");
const backgroundColorInput = /** @type {HTMLInputElement | null} */ (
  document.getElementById("backgroundColorInput")
);
const backgroundColorHex = /** @type {HTMLInputElement | null} */ (
  document.getElementById("backgroundColorHex")
);
const stickerSearchBar = document.getElementById("stickerSearchBar");
const stickerSearchInput = /** @type {HTMLInputElement | null} */ (
  document.getElementById("stickerSearchInput")
);
const stickerSearchFeedback = document.getElementById("stickerSearchFeedback");
const thumbGrid = document.getElementById("thumbGrid");
const seedInput = /** @type {HTMLInputElement} */ (document.getElementById("seedInput"));
const themeSwitch = /** @type {HTMLButtonElement} */ (document.getElementById("themeSwitch"));
const modeLightLabel = document.getElementById("modeLightLabel");
const modeDarkLabel = document.getElementById("modeDarkLabel");

const btnRandom = document.getElementById("btnRandom");
const btnReset = document.getElementById("btnReset");
const btnDownload = document.getElementById("btnDownload");
const customOverlayScale = /** @type {HTMLInputElement | null} */ (
  document.getElementById("customOverlayScale")
);
const stickerRotation = /** @type {HTMLInputElement | null} */ (
  document.getElementById("stickerRotation")
);
const stickerRotationValue = document.getElementById("stickerRotationValue");
const stickerControls = document.getElementById("stickerControls");
const customOverlayHint = document.getElementById("customOverlayHint");
const btnCustomReset = document.getElementById("btnCustomReset");
const THEME_KEY = "dripster-theme";

function getActiveStickerCatalog() {
  return stickerCatalogBySource[activeStickerSubTab];
}

function getStickerCount() {
  return Math.max(1, getActiveStickerCatalog().length + 1);
}

function isStickerSelectedInSubTab(source, index) {
  return stickerOverlay.source === source && stickerOverlay.index === index;
}

function persistStickerOverlay() {
  localStorage.setItem(CUSTOM_OVERLAY_STORAGE_KEY, JSON.stringify(stickerOverlay));
}

function applyActiveStickerImage() {
  const url = activeStickerFullUrl();
  activeStickerImage = url ? imageCache.get(url) ?? null : null;
}

function syncStickerOverlayUi() {
  const hasSticker = stickerOverlay.index > 0 && Boolean(activeStickerImage?.naturalWidth);
  const onStickerTab = activeTab === STICKERS_TAB;
  stickerControls?.toggleAttribute("hidden", !(hasSticker && onStickerTab));
  customOverlayHint?.toggleAttribute("hidden", !hasSticker);
  previewWrap?.classList.toggle("preview-wrap--placeable", hasSticker);
  if (customOverlayScale) {
    customOverlayScale.value = String(Math.round(stickerOverlay.scale * 100));
  }
  const deg = Math.round(stickerOverlay.rotation);
  if (stickerRotation) stickerRotation.value = String(deg);
  if (stickerRotationValue) stickerRotationValue.textContent = `${deg}°`;
}

/**
 * @param {StickerOverlay} o
 * @returns {{ w: number; h: number; cx: number; cy: number }}
 */
function stickerOverlayLayout(o, stickerImg = activeStickerImage) {
  const px = previewPixelSize();
  const img = stickerImg;
  if (!img?.naturalWidth) {
    return { w: 0, h: 0, cx: o.x * px, cy: o.y * px };
  }
  const w = px * o.scale;
  const h = (img.naturalHeight / img.naturalWidth) * w;
  return { w, h, cx: o.x * px, cy: o.y * px };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {StickerOverlay} o
 */
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {StickerOverlay} o
 * @param {HTMLImageElement | null} [stickerImg]
 */
function drawStickerOverlay(ctx, o, stickerImg = activeStickerImage) {
  const img = stickerImg;
  if (o.index <= 0 || !img?.naturalWidth) return;
  const { w, h, cx, cy } = stickerOverlayLayout(o, img);
  const rad = (o.rotation * Math.PI) / 180;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/**
 * @param {PointerEvent} e
 * @returns {{ x: number; y: number }}
 */
function normalizedPointFromPointer(e) {
  const rect = previewCanvas.getBoundingClientRect();
  const x = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

function loadStoredStickerOverlay() {
  try {
    const raw = localStorage.getItem(CUSTOM_OVERLAY_STORAGE_KEY);
    if (raw) stickerOverlay = parseStoredStickerOverlay(JSON.parse(raw));
  } catch {
    stickerOverlay = defaultStickerOverlay();
  }
}

/**
 * @returns {Promise<void>}
 */
async function loadStickerCatalog() {
  /** @type {Record<StickerSourceKey, Set<string>>} */
  const bySource = {
    skrumpeys: new Set(),
    monigga: new Set(),
  };
  const enabledSources = getStickerSourceKeys();

  if (!usesRemoteAssets()) {
    for (const p of Object.keys(traitGlobModules).sort()) {
      const skrumpeyMatch = p.match(/^\.\/traits\/stickers\/[^/]+$/i);
      const moniggaMatch = p.match(/^\.\/traits\/monigga\/[^/]+$/i);
      if (!skrumpeyMatch && !moniggaMatch) continue;
      const raw = traitGlobModules[p];
      const url = typeof raw === "string" ? raw : moduleToUrl(raw);
      if (!url) continue;
      if (skrumpeyMatch) bySource.skrumpeys.add(url);
      if (moniggaMatch && enabledSources.includes("monigga")) bySource.monigga.add(url);
    }
  }

  try {
    const res = await fetch(traitsScanUrl(), { cache: usesRemoteAssets() ? "default" : "no-store" });
    if (res.ok) {
      /** @type {Partial<Record<string, unknown>>} */
      const scan = await res.json();
      for (const source of enabledSources) {
        const scanKey = STICKER_SOURCE_SCAN_KEY[source];
        const list = scan[scanKey];
        if (!Array.isArray(list)) continue;
        for (const name of list) {
          if (typeof name === "string" && name) {
            bySource[source].add(stickerSourceAssetUrl(source, name));
          }
        }
      }
    }
  } catch {
    /* optional */
  }

  try {
    const res = await fetch(traitsManifestUrl(), { cache: usesRemoteAssets() ? "default" : "no-store" });
    if (res.ok) {
      /** @type {Partial<Record<string, unknown>>} */
      const manifest = await res.json();
      for (const source of enabledSources) {
        const scanKey = STICKER_SOURCE_SCAN_KEY[source];
        const list = manifest[scanKey];
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          if (typeof entry !== "string" || !entry) continue;
          bySource[source].add(stickerSourceAssetUrl(source, entry));
        }
      }
    }
  } catch {
    /* manifest optional */
  }

  if (isMoniggaStickersEnabled()) {
    const moniggaListUrls = import.meta.env.DEV
      ? ["/traits/_dev-monigga-stickers.json"]
      : [traitsMoniggaStickersUrl(), "/traits/_monigga-stickers.json"];
    for (const url of moniggaListUrls) {
      try {
        const res = await fetch(url, { cache: usesRemoteAssets() ? "default" : "no-store" });
        if (!res.ok) continue;
        const list = await res.json();
        if (!Array.isArray(list)) continue;
        for (const name of list) {
          if (typeof name === "string" && name) {
            bySource.monigga.add(stickerSourceAssetUrl("monigga", name));
          }
        }
        break;
      } catch {
        /* try next source */
      }
    }
  }

  for (const source of STICKER_SOURCE_KEYS) {
    stickerCatalogBySource[source].length = 0;
    if (enabledSources.includes(source)) {
      stickerCatalogBySource[source].push(...dedupeTraitUrls([...bySource[source]]));
    }
  }
  rebuildStickerIdMaps();
}

function syncStickerSourceAccess() {
  const sources = getStickerSourceKeys();
  if (!sources.includes(activeStickerSubTab)) {
    activeStickerSubTab = sources[0] ?? "skrumpeys";
  }
  if (!isMoniggaStickersEnabled() && stickerOverlay.source === "monigga") {
    stickerOverlay = defaultStickerOverlay();
  }
}

function clampStickerSelection() {
  const catalogLen = stickerCatalogBySource[stickerOverlay.source]?.length ?? 0;
  stickerOverlay = clampStickerOverlay(stickerOverlay, catalogLen);
  applyActiveStickerImage();
}

const panelPreview = document.querySelector(".panel--preview");
const panelPicker = document.querySelector(".panel--picker");
const previewLayoutQuery = window.matchMedia("(min-width: 861px)");

function syncPickerHeightToPreview() {
  if (!panelPicker || !panelPreview) return;
  if (!previewLayoutQuery.matches) {
    panelPicker.style.height = "";
    return;
  }
  const h = panelPreview.getBoundingClientRect().height;
  panelPicker.style.height = `${Math.round(h)}px`;
}

if (panelPreview && panelPicker) {
  const ro = new ResizeObserver(() => {
    syncPickerHeightToPreview();
  });
  ro.observe(panelPreview);
  previewLayoutQuery.addEventListener("change", syncPickerHeightToPreview);
  window.addEventListener("resize", syncPickerHeightToPreview);
}

/** Background index: custom color (after trait images) */
function getBackgroundCustomIndex() {
  return traitCatalog.background.length + 1;
}

/** @param {number} idx
 * @returns {boolean}
 */
function isCustomBackgroundIndex(idx) {
  return idx === getBackgroundCustomIndex();
}

function persistCustomBackgroundColor() {
  localStorage.setItem(CUSTOM_BG_COLOR_STORAGE_KEY, customBackgroundColor);
}

function loadStoredCustomBackgroundColor() {
  const stored = localStorage.getItem(CUSTOM_BG_COLOR_STORAGE_KEY);
  const hex = stored ? normalizeHexColor(stored) : null;
  if (hex) customBackgroundColor = hex;
}

function syncBackgroundColorUi() {
  const show = activeTab === "background";
  backgroundColorBar?.classList.toggle("is-visible", show);
  backgroundColorBar?.toggleAttribute("hidden", !show);
  if (backgroundColorInput) backgroundColorInput.value = customBackgroundColor;
  if (backgroundColorHex) backgroundColorHex.value = customBackgroundColor;
}

function syncStickerSearchUi() {
  const show = activeTab === STICKERS_TAB;
  stickerSearchBar?.classList.toggle("is-visible", show);
  stickerSearchBar?.toggleAttribute("hidden", !show);
  if (!show) {
    setStickerSearchFeedback("");
    return;
  }
  if (stickerSearchInput && document.activeElement !== stickerSearchInput) {
    const showId =
      stickerOverlay.index > 0 && stickerOverlay.source === activeStickerSubTab
        ? stickerIdFromPickerIndex(activeStickerSubTab, stickerOverlay.index)
        : "";
    stickerSearchInput.value = showId;
  }
}

/** Background option count for seed/random (excludes custom color slot) */
function getBackgroundPickerCount() {
  return Math.max(1, traitCatalog.background.length + 1);
}

/**
 * @param {string} hex
 */
function applyCustomBackgroundColor(hex) {
  if (activeTab !== "background") return;
  const normalized = normalizeHexColor(hex);
  if (!normalized) return;
  customBackgroundColor = normalized;
  selection = { ...selection, background: getBackgroundCustomIndex() };
  persistCustomBackgroundColor();
  if (backgroundColorInput) backgroundColorInput.value = normalized;
  if (backgroundColorHex) backgroundColorHex.value = normalized;
  syncSeed();
  renderThumbs();
  void renderPreview();
}

/** @returns {Counts} */
function getCounts() {
  /** @type {Counts} */
  const counts = defaultSelection();
  for (const key of CATEGORY_KEYS) {
    if (key === "background") {
      counts.background = Math.max(1, traitCatalog.background.length + 2);
    } else {
      counts[key] = Math.max(1, traitCatalog[key].length + 1);
    }
  }
  return counts;
}

function syncSeed() {
  seedInput.value = String(selectionToSeed(selection));
}

/** @typedef {"light" | "dark"} ThemeMode */

/**
 * @param {ThemeMode} mode
 */
function applyTheme(mode) {
  document.documentElement.setAttribute("data-theme", mode);
  const isDark = mode === "dark";
  themeSwitch.setAttribute("aria-pressed", isDark ? "true" : "false");
  themeSwitch.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  modeLightLabel?.classList.toggle("collection-name--active", !isDark);
  modeDarkLabel?.classList.toggle("collection-name--active", isDark);
  renderThumbs();
  syncBackgroundColorUi();
  requestAnimationFrame(() => syncPickerHeightToPreview());
}

/**
 * @returns {ThemeMode}
 */
function getInitialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Selection} sel
 * @param {LruImageCache} [cache]
 * @param {HTMLImageElement | null} [stickerImg]
 * @param {(cat: CategoryKey, index: number) => string | null} [resolveUrl]
 */
function drawComposite(
  ctx,
  sel,
  cache = imageCache,
  stickerImg = activeStickerImage,
  resolveUrl = resolveLayerUrl,
) {
  const px = previewPixelSize();
  ctx.clearRect(0, 0, px, px);

  const hasCustomBg = isCustomBackgroundIndex(sel.background);
  const hasImageBg = sel.background > 0 && sel.background <= traitCatalog.background.length;

  if (!hasCustomBg && !hasImageBg && traitCatalog.background.length === 0) {
    const grad = ctx.createLinearGradient(0, 0, px, px);
    grad.addColorStop(0, "#e0e7ff");
    grad.addColorStop(1, "#f5d0fe");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, px, px);
  }

  for (const key of COMPOSITE_ORDER) {
    if (key === "background" && hasCustomBg) {
      ctx.fillStyle = customBackgroundColor;
      ctx.fillRect(0, 0, px, px);
      continue;
    }
    const url = resolveUrl(key, sel[key]);
    const img = url ? cache.get(url) : undefined;
    if (img) {
      ctx.drawImage(img, 0, 0, px, px);
    }
  }

  drawStickerOverlay(ctx, stickerOverlay, stickerImg);
}

/**
 * @param {Selection} sel
 * @param {LruImageCache} cache
 * @returns {{ expected: number; loaded: number }}
 */
function countLoadedLayersInCache(sel, cache) {
  let expected = 0;
  let loaded = 0;
  for (const key of COMPOSITE_ORDER) {
    if (key === "background" && isCustomBackgroundIndex(sel.background)) continue;
    const url = resolveLayerUrl(key, sel[key]);
    if (!url) continue;
    expected += 1;
    if (cache.get(url)?.naturalWidth) loaded += 1;
  }
  if (stickerOverlay.index > 0) {
    const url = activeStickerFullUrl();
    if (url) {
      expected += 1;
      if (cache.get(url)?.naturalWidth) loaded += 1;
    }
  }
  return { expected, loaded };
}

/**
 * @param {Selection} [sel]
 * @returns {Promise<HTMLImageElement | null>}
 */
async function loadExportLayers(sel = selection) {
  exportImageCache.map.clear();

  /** @type {Promise<unknown>[]} */
  const jobs = [];
  for (const key of COMPOSITE_ORDER) {
    if (key === "background" && isCustomBackgroundIndex(sel.background)) continue;
    const url = resolveLayerUrl(key, sel[key]);
    if (!url) continue;
    jobs.push(loadExportTraitImage(exportImageCache, url));
  }

  let stickerImg = null;
  if (stickerOverlay.index > 0) {
    const url = activeStickerFullUrl();
    if (url) {
      jobs.push(
        loadExportTraitImage(exportImageCache, url).then((img) => {
          stickerImg = img;
        }),
      );
    }
  }

  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    throw failed[0].reason ?? new Error(`${failed.length} layer(s) failed to load`);
  }
  if (jobs.length > 0 && results.every((r) => r.status !== "fulfilled")) {
    throw new Error("no layers loaded");
  }
  return stickerImg;
}

/**
 * @param {CategoryKey | null} [focusCat] Layer that changed (mobile loads only this layer first).
 */
async function renderPreview(focusCat = null) {
  previewRenderToken += 1;
  const token = previewRenderToken;
  await prefetchSelectionLayers(selection, token, focusCat);
  if (token !== previewRenderToken) return;
  if (stickerOverlay.index > 0) {
    await refreshActiveStickerImage();
    if (token !== previewRenderToken) return;
  }
  drawComposite(previewCtx, selection);
}

/**
 * @returns {HTMLCanvasElement}
 */
function thumbCanvasPixelSize() {
  const mobile = isMobilePickerDevice();
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2.5);
  const scale = mobile ? 1.25 : 2.5;
  const px = Math.round(THUMB * dpr * scale);
  const maxPx = mobile ? 192 : 512;
  const minPx = mobile ? 96 : 256;
  return Math.min(maxPx, Math.max(minPx, px));
}

function createEmptyThumbPlaceholder() {
  const el = document.createElement("span");
  el.className = "thumb-placeholder";
  el.setAttribute("aria-hidden", "true");
  return el;
}

function createThumbCanvas() {
  const c = document.createElement("canvas");
  const tctx = c.getContext("2d");
  if (!tctx) return c;

  const px = thumbCanvasPixelSize();
  c.width = px;
  c.height = px;
  c.style.width = "100%";
  c.style.height = "100%";
  c.style.display = "block";
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "high";
  const k = px / THUMB;
  tctx.setTransform(k, 0, 0, k, 0, 0);
  return c;
}

/**
 * @param {string} key
 * @returns {HTMLCanvasElement | null}
 */
function getThumbPaintCache(key) {
  const hit = thumbPaintCache.get(key);
  if (!hit) return null;
  thumbPaintCache.delete(key);
  thumbPaintCache.set(key, hit);
  return hit;
}

/**
 * @param {string} key
 * @param {HTMLCanvasElement} canvas
 */
function setThumbPaintCache(key, canvas) {
  if (useSimpleMobileThumbs()) return;
  const px = thumbCanvasPixelSize();
  const clone = document.createElement("canvas");
  clone.width = px;
  clone.height = px;
  const ctx = clone.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(canvas, 0, 0);
  if (thumbPaintCache.has(key)) thumbPaintCache.delete(key);
  thumbPaintCache.set(key, clone);
  while (thumbPaintCache.size > maxThumbPaintCacheEntries()) {
    const oldest = thumbPaintCache.keys().next().value;
    if (oldest) thumbPaintCache.delete(oldest);
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} cacheKey
 * @returns {boolean}
 */
function restorePaintedThumb(canvas, cacheKey) {
  if (useSimpleMobileThumbs()) return false;
  const src = getThumbPaintCache(cacheKey);
  if (!src || src.width !== canvas.width || src.height !== canvas.height) return false;
  const tctx = canvas.getContext("2d");
  if (!tctx) return false;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, canvas.width, canvas.height);
  tctx.drawImage(src, 0, 0);
  const k = canvas.width / THUMB;
  tctx.setTransform(k, 0, 0, k, 0, 0);
  return true;
}

function drawEmptyThumb(c) {
  const tctx = c.getContext("2d");
  if (!tctx) return;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  tctx.fillStyle = dark ? "rgb(255 255 255 / 0.06)" : "rgb(0 0 0 / 0.06)";
  tctx.fillRect(0, 0, THUMB, THUMB);
  tctx.strokeStyle = dark ? "rgb(255 255 255 / 0.1)" : "rgb(0 0 0 / 0.1)";
  tctx.setLineDash([3, 3]);
  tctx.strokeRect(0.5, 0.5, THUMB - 1, THUMB - 1);
}

/** @param {HTMLCanvasElement} c */
function drawCustomBackgroundThumb(c) {
  const tctx = c.getContext("2d");
  if (!tctx) return;
  tctx.fillStyle = customBackgroundColor;
  tctx.fillRect(0, 0, THUMB, THUMB);
  tctx.strokeStyle = "rgb(0 0 0 / 0.18)";
  tctx.setLineDash([4, 3]);
  tctx.lineWidth = 1.5;
  tctx.strokeRect(1, 1, THUMB - 2, THUMB - 2);
  tctx.setLineDash([]);

  const size = THUMB * 0.44;
  const x = (THUMB - size) / 2;
  const y = (THUMB - size) / 2 - THUMB * 0.05;
  const radius = size * 0.16;
  const pad = size * 0.24;
  const pip = size * 0.11;

  tctx.fillStyle = "rgb(255 255 255 / 0.95)";
  tctx.beginPath();
  tctx.roundRect(x, y, size, size, radius);
  tctx.fill();
  tctx.strokeStyle = "rgb(0 0 0 / 0.28)";
  tctx.lineWidth = 1.25;
  tctx.stroke();

  tctx.fillStyle = "rgb(0 0 0 / 0.8)";
  const drawPip = (/** @type {number} */ px, /** @type {number} */ py) => {
    tctx.beginPath();
    tctx.arc(x + px, y + py, pip, 0, Math.PI * 2);
    tctx.fill();
  };
  drawPip(pad, pad);
  drawPip(size - pad, pad);
  drawPip(size / 2, size / 2);
  drawPip(pad, size - pad);
  drawPip(size - pad, size - pad);
}

/**
 * @typedef {{ sx: number; sy: number; sw: number; sh: number }} ThumbCrop
 */

/**
 * Layer exports are often 4000×4000 with art in one region — crop to visible pixels for thumbs.
 * @param {HTMLImageElement} img
 * @param {string} cacheKey
 * @returns {Promise<ThumbCrop | null>}
 */
async function getImageAlphaBounds(img, cacheKey) {
  if (thumbBoundsCache.has(cacheKey)) {
    return thumbBoundsCache.get(cacheKey) ?? null;
  }

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) {
    thumbBoundsCache.set(cacheKey, null);
    return null;
  }

  const sample = 256;
  const scale = Math.min(1, sample / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  const oc = document.createElement("canvas");
  oc.width = w;
  oc.height = h;
  const ctx = oc.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    thumbBoundsCache.set(cacheKey, null);
    return null;
  }

  try {
    ctx.drawImage(img, 0, 0, w, h);
  } catch {
    thumbBoundsCache.set(cacheKey, null);
    return null;
  }

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // Cross-origin image without CORS taints the canvas — skip crop, still show thumb.
    thumbBoundsCache.set(cacheKey, null);
    return null;
  }

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX) {
    thumbBoundsCache.set(cacheKey, null);
    return null;
  }

  const inv = 1 / scale;
  /** @type {ThumbCrop} */
  const crop = {
    sx: minX * inv,
    sy: minY * inv,
    sw: (maxX - minX + 1) * inv,
    sh: (maxY - minY + 1) * inv,
  };
  thumbBoundsCache.set(cacheKey, crop);
  return crop;
}

/**
 * @param {string} url
 * @param {ThumbLayout} [layout]
 */
function thumbPaintCacheKey(url, layout = "default") {
  return layout === "default" ? url : `${url}#${layout}`;
}

/**
 * Bottom-align collab clothes in the tab thumb so every item shares one baseline above the brand bar.
 * @param {HTMLCanvasElement} c
 * @param {HTMLImageElement} img
 * @param {ThumbCrop} crop
 */
function drawCollabClothesOnThumb(c, img, crop) {
  const tctx = c.getContext("2d");
  if (!tctx || !img.naturalWidth) return;

  const drawH = THUMB - COLLAB_THUMB_BRAND_INSET;
  const pad = drawH * 0.12;
  const innerW = THUMB - pad * 2;
  const innerH = drawH - pad * 2;
  const scale = Math.min(innerW / crop.sw, innerH / crop.sh);
  const w = crop.sw * scale;
  const h = crop.sh * scale;
  const x = (THUMB - w) / 2;
  const y = drawH - pad - h;

  tctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, x, y, w, h);
}

/**
 * @param {HTMLCanvasElement} c
 * @param {HTMLImageElement} img
 * @param {boolean} [contain]
 * @param {ThumbCrop | null} [crop]
 * @param {ThumbLayout} [layout]
 */
function drawImageOnThumb(c, img, contain = false, crop = null, layout = "default") {
  if (layout === "collab-clothes" && crop) {
    drawCollabClothesOnThumb(c, img, crop);
    return;
  }

  const tctx = c.getContext("2d");
  if (!tctx || !img.naturalWidth) return;

  const pad = THUMB * (crop ? 0.15 : 0.08);
  const box = THUMB - pad * 2;

  if (crop) {
    const scale = Math.min(box / crop.sw, box / crop.sh);
    const w = crop.sw * scale;
    const h = crop.sh * scale;
    tctx.drawImage(
      img,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      (THUMB - w) / 2,
      (THUMB - h) / 2,
      w,
      h,
    );
    return;
  }

  if (!contain) {
    tctx.drawImage(img, 0, 0, THUMB, THUMB);
    return;
  }

  const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  tctx.drawImage(img, (THUMB - w) / 2, (THUMB - h) / 2, w, h);
}

/**
 * @param {string | null} thumbUrl
 * @param {string | null} fallbackUrl
 * @returns {Promise<HTMLImageElement | null>}
 */
async function loadThumbImage(thumbUrl, fallbackUrl) {
  if (thumbUrl) {
    try {
      return await getCachedImage(imageCache, thumbUrl);
    } catch {
      /* try full size */
    }
  }
  if (fallbackUrl) {
    try {
      return await getCachedImage(imageCache, fallbackUrl);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} img
 * @param {boolean} [contain]
 * @param {ThumbCrop | null} [crop]
 * @param {ThumbLayout} [layout]
 */
function paintThumbCanvas(canvas, img, contain = false, crop = null, layout = "default") {
  const tctx = canvas.getContext("2d");
  if (!tctx || !img.naturalWidth) return;
  const px = thumbCanvasPixelSize();
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, px, px);
  const k = px / THUMB;
  tctx.setTransform(k, 0, 0, k, 0, 0);
  drawImageOnThumb(canvas, img, contain, crop, layout);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ thumbUrl: string | null; fullUrl: string | null; contain?: boolean; cropToContent?: boolean; layout?: ThumbLayout }} opts
 * @returns {boolean}
 */
function trySyncHydrateThumb(canvas, opts) {
  const { thumbUrl, fullUrl, contain = false, cropToContent = false, layout = "default" } = opts;
  const cacheUrl = fullUrl || thumbUrl;
  if (!cacheUrl) return false;
  const paintKey = thumbPaintCacheKey(cacheUrl, layout);
  if (restorePaintedThumb(canvas, paintKey)) return true;

  const cached =
    (thumbUrl ? imageCache.get(thumbUrl) : undefined) ??
    (fullUrl ? imageCache.get(fullUrl) : undefined);
  if (!cached?.naturalWidth) return false;

  let crop = null;
  if (cropToContent) {
    if (!thumbBoundsCache.has(cacheUrl)) return false;
    crop = thumbBoundsCache.get(cacheUrl) ?? null;
  }

  paintThumbCanvas(canvas, cached, contain, crop, layout);
  if (!useSimpleMobileThumbs()) setThumbPaintCache(paintKey, canvas);
  return true;
}

/**
 * @param {HTMLButtonElement} btn
 * @param {number} token
 * @param {() => { thumbUrl: string | null; fullUrl: string | null; contain?: boolean; cropToContent?: boolean; layout?: ThumbLayout }} getUrls
 */
async function hydrateThumbButton(btn, token, getUrls) {
  if (token !== thumbRenderToken) return;
  const canvas = btn.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const opts = getUrls();
  const { thumbUrl, fullUrl, contain = false, cropToContent = false, layout = "default" } = opts;
  const cacheUrl = fullUrl || thumbUrl;
  const paintKey = cacheUrl ? thumbPaintCacheKey(cacheUrl, layout) : null;

  const paint = async (/** @type {HTMLImageElement} */ img) => {
    let crop = null;
    if (cropToContent && cacheUrl) {
      try {
        crop = await getImageAlphaBounds(img, cacheUrl);
      } catch {
        crop = null;
      }
    }
    if (token !== thumbRenderToken || !btn.isConnected) return;
    paintThumbCanvas(canvas, img, contain, crop, layout);
    if (paintKey && !useSimpleMobileThumbs()) setThumbPaintCache(paintKey, canvas);
    btn.classList.remove("thumb--loading");
  };

  if (trySyncHydrateThumb(canvas, opts)) {
    btn.classList.remove("thumb--loading");
    return;
  }

  const cached =
    (thumbUrl ? imageCache.get(thumbUrl) : undefined) ??
    (fullUrl ? imageCache.get(fullUrl) : undefined);
  if (cached?.naturalWidth) {
    await paint(cached);
    return;
  }

  const img = await loadThumbImage(thumbUrl, fullUrl);
  if (token !== thumbRenderToken || !btn.isConnected) return;
  if (!img) {
    btn.classList.remove("thumb--loading");
    return;
  }

  await paint(img);
}

/**
 * @param {CategoryKey} cat
 * @param {number} index
 * @param {boolean} selected
 * @param {number} token
 * @returns {HTMLButtonElement}
 */
function createTraitThumbButton(cat, index, selected, token) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "thumb";
  if (cat === "background" && isCustomBackgroundIndex(index)) {
    btn.classList.add("thumb--custom-bg");
    btn.title = "Custom color — click to pick";
    btn.setAttribute("aria-label", "Custom background color");
  }
  btn.setAttribute("aria-selected", selected ? "true" : "false");
  btn.dataset.index = String(index);
  if (index === 0 && (cat === "frame" || cat === "accessories")) {
    btn.title = "None";
    btn.setAttribute("aria-label", "None");
  }

  if (useSimpleMobileThumbs()) {
    if (index === 0) {
      btn.appendChild(createEmptyThumbPlaceholder());
    } else if (cat === "background" && isCustomBackgroundIndex(index)) {
      const canvas = createThumbCanvas();
      drawCustomBackgroundThumb(canvas);
      btn.appendChild(canvas);
    } else if (index > 0) {
      const fullUrl = traitFullUrl(cat, index);
      if (fullUrl) btn.appendChild(createLazyThumbImage(fullUrl, cat));
    }
  } else {
    const canvas = createThumbCanvas();
    if (index === 0) {
      drawEmptyThumb(canvas);
    } else if (cat === "background" && isCustomBackgroundIndex(index)) {
      drawCustomBackgroundThumb(canvas);
    }
    btn.appendChild(canvas);

    if (index > 0 && !(cat === "background" && isCustomBackgroundIndex(index))) {
      const fullUrl = traitFullUrl(cat, index);
      const opts =
        cat === "background"
          ? { thumbUrl: null, fullUrl, contain: true }
          : { thumbUrl: null, fullUrl, cropToContent: true };
      if (!trySyncHydrateThumb(canvas, opts)) {
        btn.classList.add("thumb--loading");
        scheduleHydrateThumb(() => hydrateThumbButton(btn, token, () => opts));
      }
    }
  }

  if (cat === "background" && isCustomBackgroundIndex(index)) {
    const badge = document.createElement("span");
    badge.className = "thumb-custom-bg-badge";
    badge.textContent = "Custom";
    btn.appendChild(badge);
  }

  btn.addEventListener("click", () => {
    void onTraitThumbClick(cat, index);
  });
  return btn;
}

/**
 * @param {CategoryKey} cat
 * @param {number} index
 */
async function onTraitThumbClick(cat, index) {
  if (!consumePickerInteraction()) return;
  if (COLLAB_LAYER_KEYS.includes(cat)) {
    clearCollabForCategory(cat);
  }
  selection = { ...selection, [cat]: index };
  const locksChanged = enforceTraitLocks();
  syncSeed();
  if (locksChanged) {
    scheduleRenderThumbs();
  } else {
    updatePickerSelectionHighlight(cat);
  }
  if (cat === "background" && isCustomBackgroundIndex(index)) {
    backgroundColorInput?.click();
    await renderPreview("background");
    return;
  }
  const url = resolveLayerUrl(cat, index);
  if (url && !isMobilePickerDevice()) await getCachedImage(imageCache, url).catch(() => null);
  await renderPreview(cat);
}

/**
 * @param {CollabThumbEntry} entry
 * @param {boolean} selected
 * @param {number} token
 * @returns {HTMLButtonElement}
 */
function createCollabThumbButton(entry, selected, token) {
  const meta = collabCatalog[entry.collabId];
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `thumb thumb--collab-labeled thumb--${entry.collabId}`;
  btn.setAttribute("aria-selected", selected ? "true" : "false");
  btn.title = `${meta?.label ?? entry.collabId} · ${entry.label}`;

  const brand = document.createElement("span");
  brand.className = "thumb-collab-brand";
  brand.textContent = meta?.label ?? entry.collabId;
  if (meta?.accent) btn.style.setProperty("--collab-accent", meta.accent);

  if (useSimpleMobileThumbs()) {
    const img = createLazyThumbImage(entry.url, entry.category);
    if (entry.category === "clothes") img.classList.add("thumb-img--collab-clothes");
    btn.appendChild(img);
    btn.appendChild(brand);
  } else {
    const canvas = createThumbCanvas();
    btn.appendChild(canvas);
    btn.appendChild(brand);
    const thumbLayout = /** @type {ThumbLayout} */ (
      entry.category === "clothes" ? "collab-clothes" : "default"
    );
    const opts = { thumbUrl: null, fullUrl: entry.url, cropToContent: true, layout: thumbLayout };
    if (!trySyncHydrateThumb(canvas, opts)) {
      btn.classList.add("thumb--loading");
      scheduleHydrateThumb(() => hydrateThumbButton(btn, token, () => opts));
    }
  }

  btn.addEventListener("click", () => {
    void onCategoryEntryClick(entry.category, entry);
  });
  return btn;
}

/**
 * @param {number} index
 * @param {boolean} selected
 * @param {number} token
 * @returns {HTMLButtonElement}
 */
function createStickerThumbButton(index, selected, token) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "thumb thumb--sticker";
  btn.setAttribute("aria-selected", selected ? "true" : "false");
  btn.dataset.index = String(index);

  if (useSimpleMobileThumbs()) {
    if (index === 0) {
      btn.appendChild(createEmptyThumbPlaceholder());
    } else {
      const fullUrl = stickerFullUrl(activeStickerSubTab, index);
      if (fullUrl) btn.appendChild(createLazyThumbImage(fullUrl, STICKERS_TAB));
    }
  } else {
    const canvas = createThumbCanvas();
    if (index === 0) {
      drawEmptyThumb(canvas);
    }
    btn.appendChild(canvas);

    if (index > 0) {
      const fullUrl = stickerFullUrl(activeStickerSubTab, index);
      const opts = { thumbUrl: null, fullUrl, contain: true };
      if (!trySyncHydrateThumb(canvas, opts)) {
        btn.classList.add("thumb--loading");
        scheduleHydrateThumb(() => hydrateThumbButton(btn, token, () => opts));
      }
    }
  }

  btn.addEventListener("click", () => {
    void onStickerThumbClick(index);
  });
  return btn;
}

/**
 * @param {number} index
 */
async function onStickerThumbClick(index) {
  if (!consumePickerInteraction()) return;
  stickerOverlay = { ...stickerOverlay, source: activeStickerSubTab, index };
  await refreshActiveStickerImage();
  persistStickerOverlay();
  syncStickerOverlayUi();
  if (stickerSearchInput) {
    stickerSearchInput.value =
      index > 0 ? stickerIdFromPickerIndex(activeStickerSubTab, index) : "";
    setStickerSearchFeedback("");
  }
  updatePickerSelectionHighlight(STICKERS_TAB);
  await renderPreview();
}

async function applyStickerSearch() {
  if (!stickerSearchInput) return;
  const query = stickerSearchInput.value.trim();
  if (!query) return;

  const index = findStickerPickerIndexById(activeStickerSubTab, query);
  if (index == null) {
    setStickerSearchFeedback(`Sticker "${normalizeStickerIdQuery(query)}" not found`, true);
    return;
  }

  setStickerSearchFeedback("");
  stickerOverlay = { ...stickerOverlay, source: activeStickerSubTab, index };
  await refreshActiveStickerImage();
  persistStickerOverlay();
  syncStickerOverlayUi();
  stickerSearchInput.value = stickerIdFromPickerIndex(activeStickerSubTab, index);
  updatePickerSelectionHighlight(STICKERS_TAB);
  scrollThumbGridToIndex(index);
  await renderPreview();
}

/**
 * @param {number} count
 * @param {number} token
 * @param {(index: number) => HTMLButtonElement} factory
 */
function mountThumbGrid(count, token, factory) {
  if (!thumbGrid) return;
  virtualThumbMount = null;
  thumbGrid.classList.remove("thumb-grid--virtual");
  thumbGrid.onscroll = null;
  /** @type {((this: HTMLElement, ev: Event) => void) | null} */
  thumbGrid.onscrollend = null;
  thumbGrid.innerHTML = "";

  for (let i = 0; i < count; i++) {
    thumbGrid.appendChild(factory(i));
  }
}

/**
 * @param {number} count
 * @param {number} token
 * @param {(index: number) => HTMLButtonElement} factory
 */
function mountVirtualThumbGrid(count, token, factory) {
  if (!thumbGrid) return;

  const { cols, cell, rowHeight } = getThumbGridMetrics();
  const totalRows = Math.ceil(count / cols);
  const viewH = thumbGrid.clientHeight || 400;
  const scrollTop = thumbGrid.scrollTop;
  const buffer = isMobilePickerDevice() ? 1 : 2;
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewH) / rowHeight) + buffer);

  if (
    virtualThumbMount &&
    virtualThumbMount.token === token &&
    virtualThumbMount.count === count &&
    virtualThumbMount.cols === cols &&
    virtualThumbMount.startRow === startRow &&
    virtualThumbMount.endRow === endRow
  ) {
    return;
  }
  virtualThumbMount = { token, count, cols, startRow, endRow };

  const savedScrollTop = scrollTop;
  thumbGrid.classList.add("thumb-grid--virtual");
  thumbGrid.innerHTML = "";

  const top = document.createElement("div");
  top.className = "thumb-virtual-spacer";
  top.style.height = `${startRow * rowHeight}px`;

  const windowEl = document.createElement("div");
  windowEl.className = "thumb-grid-window";
  windowEl.style.setProperty("--thumb-cols", String(cols));
  windowEl.style.gridAutoRows = `${cell}px`;

  const start = startRow * cols;
  const end = Math.min(count, endRow * cols);
  for (let i = start; i < end; i++) {
    windowEl.appendChild(factory(i));
  }

  const bottom = document.createElement("div");
  bottom.className = "thumb-virtual-spacer";
  bottom.style.height = `${Math.max(0, totalRows - endRow) * rowHeight}px`;

  thumbGrid.append(top, windowEl, bottom);

  let scrollLocked = true;
  thumbGrid.onscroll = null;
  /** @type {((this: HTMLElement, ev: Event) => void) | null} */
  thumbGrid.onscrollend = null;
  thumbGrid.scrollTop = savedScrollTop;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollLocked = false;
    });
  });

  const scheduleVirtualRemount = () => {
    if (scrollLocked) return;
    cancelAnimationFrame(thumbScrollRaf);
    thumbScrollRaf = requestAnimationFrame(() => {
      if (token !== thumbRenderToken) return;
      if (isMobilePickerDevice()) {
        const now = performance.now();
        if (now - lastVirtualScrollAt < MOBILE_VIRTUAL_SCROLL_MS) return;
        lastVirtualScrollAt = now;
      }
      mountVirtualThumbGrid(count, token, factory);
    });
  };

  if (isMobilePickerDevice() && "onscrollend" in thumbGrid) {
    thumbGrid.onscrollend = scheduleVirtualRemount;
  } else {
    thumbGrid.onscroll = scheduleVirtualRemount;
  }
}

function clampCollabSelection() {
  /** @type {CollabSelection} */
  let next = { ...collabSelection, partner: { ...collabSelection.partner } };
  for (const cat of COLLAB_LAYER_KEYS) {
    if (next[cat] <= 0) {
      delete next.partner[cat];
      continue;
    }
    const partnerId = collabPartnerFor(cat, next);
    if (!partnerId) {
      next = withoutCollabCategory(next, cat);
      continue;
    }
    const max = collabCatalog[partnerId][cat].length;
    next[cat] = Math.max(0, Math.min(next[cat], max));
    if (next[cat] === 0) next = withoutCollabCategory(next, cat);
  }
  collabSelection = next;
  enforceTraitLocks();
}

function renderStickerSubTabs() {
  if (!stickerSubTabsEl) return;
  const onStickerTab = activeTab === STICKERS_TAB;
  const sources = getStickerSourceKeys();
  const showSubTabs = onStickerTab && sources.length > 1;
  stickerSubTabsEl.toggleAttribute("hidden", !showSubTabs);
  if (!showSubTabs) {
    stickerSubTabsEl.innerHTML = "";
    return;
  }
  stickerSubTabsEl.innerHTML = "";
  for (const key of sources) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sub-tab";
    btn.role = "tab";
    btn.textContent = STICKER_SOURCE_LABELS[key];
    btn.setAttribute("aria-selected", key === activeStickerSubTab ? "true" : "false");
    btn.addEventListener("click", () => {
      if (activeStickerSubTab === key) return;
      activeStickerSubTab = key;
      renderStickerSubTabs();
      syncStickerSearchUi();
      scheduleRenderThumbs();
    });
    stickerSubTabsEl.appendChild(btn);
  }
}

function renderTabs() {
  if (!tabsEl) return;
  tabsEl.innerHTML = "";
  for (const key of PICKER_TAB_KEYS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.role = "tab";
    btn.textContent = PICKER_TAB_LABELS[key];
    btn.setAttribute("aria-selected", key === activeTab ? "true" : "false");
    btn.addEventListener("click", () => {
      if (activeTab === key) return;
      activeTab = key;
      renderTabs();
      syncBackgroundColorUi();
      syncStickerSearchUi();
      syncStickerOverlayUi();
      scheduleRenderThumbs();
    });
    tabsEl.appendChild(btn);
  }
  renderStickerSubTabs();
}

/**
 * Update selected ring on existing thumbs without rebuilding canvases (avoids mobile OOM on rapid taps).
 * @param {CategoryKey | typeof STICKERS_TAB} cat
 */
function updatePickerSelectionHighlight(cat) {
  if (!thumbGrid) return;

  if (thumbGrid.classList.contains("thumb-grid--virtual")) {
    if (cat === STICKERS_TAB) {
      for (const btn of getVisibleThumbButtons()) {
        const idx = Number(btn.dataset.index);
        if (!Number.isFinite(idx)) continue;
        btn.setAttribute(
          "aria-selected",
          isStickerSelectedInSubTab(activeStickerSubTab, idx) ? "true" : "false",
        );
      }
      return;
    }
    scheduleRenderThumbs();
    return;
  }

  const buttons = getVisibleThumbButtons();
  if (!buttons.length) {
    scheduleRenderThumbs();
    return;
  }

  if (cat === STICKERS_TAB) {
    buttons.forEach((btn, i) => {
      btn.setAttribute(
        "aria-selected",
        isStickerSelectedInSubTab(activeStickerSubTab, i) ? "true" : "false",
      );
    });
    return;
  }

  if (cat !== "background") {
    const entries = getCategoryPickerEntries(cat);
    if (buttons.length === entries.length) {
      entries.forEach((entry, i) => {
        const btn = buttons[i];
        if (!btn) return;
        btn.setAttribute("aria-selected", isCategoryEntrySelected(cat, entry) ? "true" : "false");
      });
      return;
    }
  }

  buttons.forEach((btn) => {
    const idx = Number(btn.dataset.index);
    if (!Number.isFinite(idx)) return;
    btn.setAttribute("aria-selected", selection[cat] === idx ? "true" : "false");
  });
}

/** @returns {HTMLButtonElement[]} */
function getVisibleThumbButtons() {
  if (!thumbGrid) return [];
  const windowEl = thumbGrid.querySelector(".thumb-grid-window");
  if (windowEl) return [...windowEl.querySelectorAll("button.thumb")];
  return [...thumbGrid.querySelectorAll(":scope > button.thumb")];
}

function renderThumbs() {
  if (!thumbGrid) return;
  cancelAnimationFrame(thumbScrollRaf);
  cancelAnimationFrame(thumbRenderScheduleRaf);
  thumbRenderScheduleRaf = 0;
  cancelThumbHydrateQueue();
  disconnectThumbImgObserver();
  thumbGrid.onscroll = null;
  /** @type {((this: HTMLElement, ev: Event) => void) | null} */
  thumbGrid.onscrollend = null;
  virtualThumbMount = null;
  if (isMobilePickerDevice()) {
    thumbPaintCache.clear();
    if (thumbBoundsCache.size > 64) thumbBoundsCache.clear();
  } else if (thumbPaintCache.size > maxThumbPaintCacheEntries()) {
    thumbPaintCache.clear();
  }
  trimImageCacheForDevice();
  thumbRenderToken += 1;
  const token = thumbRenderToken;
  const virtualThreshold = effectiveVirtualThreshold();
  syncBackgroundColorUi();
  syncStickerSearchUi();

  if (activeTab === STICKERS_TAB) {
    const count = getStickerCount();
    const source = activeStickerSubTab;
    const factory = (i) =>
      createStickerThumbButton(i, isStickerSelectedInSubTab(source, i), token);
    if (count > virtualThreshold) {
      mountVirtualThumbGrid(count, token, factory);
    } else {
      mountThumbGrid(count, token, factory);
    }
    return;
  }

  const cat = /** @type {CategoryKey} */ (activeTab);
  if (COLLAB_LAYER_KEYS.includes(cat)) {
    const entries = getCategoryPickerEntries(cat);
    const factory = (i) =>
      createCategoryThumbButton(cat, entries[i], isCategoryEntrySelected(cat, entries[i]), token);
    if (entries.length > virtualThreshold) {
      mountVirtualThumbGrid(entries.length, token, factory);
    } else {
      mountThumbGrid(entries.length, token, factory);
    }
    return;
  }

  let count;
  /** @type {(i: number) => HTMLButtonElement} */
  let factory;
  if (cat === "background") {
    count = getCounts().background;
    factory = (i) => createTraitThumbButton(cat, i, selection[cat] === i, token);
  } else {
    const entries = getCategoryPickerEntries(cat);
    count = entries.length;
    factory = (i) =>
      createCategoryThumbButton(cat, entries[i], isCategoryEntrySelected(cat, entries[i]), token);
  }

  if (count > virtualThreshold) {
    mountVirtualThumbGrid(count, token, factory);
  } else {
    mountThumbGrid(count, token, factory);
  }
}

async function randomize() {
  const counts = getCounts();
  /** @type {Selection} */
  const next = { ...selection };
  for (const key of CATEGORY_KEYS) {
    if (key === "skin") {
      next.skin = pickRandomSkinIndex();
      continue;
    }
    const n = key === "background" ? getBackgroundPickerCount() : counts[key];
    next[key] = Math.floor(Math.random() * n);
  }
  selection = next;
  collabSelection = defaultCollabSelection();
  stickerOverlay = defaultStickerOverlay();
  applyActiveStickerImage();
  persistStickerOverlay();
  syncStickerOverlayUi();
  syncSeed();
  renderThumbs();
  await renderPreview();
}

async function resetSelection() {
  selection = defaultSelection();
  selection.skin = pickRandomSkinIndex();
  collabSelection = defaultCollabSelection();
  customBackgroundColor = defaultCustomBackgroundColor();
  persistCustomBackgroundColor();
  stickerOverlay = defaultStickerOverlay();
  applyActiveStickerImage();
  persistStickerOverlay();
  syncStickerOverlayUi();
  syncBackgroundColorUi();
  syncSeed();
  renderThumbs();
  await renderPreview();
}

function resetStickerPosition() {
  const { index, source } = stickerOverlay;
  stickerOverlay = { ...defaultStickerOverlay(), index, source };
  applyActiveStickerImage();
  persistStickerOverlay();
  syncStickerOverlayUi();
  void renderPreview();
}

async function downloadPng() {
  if (!btnDownload) return;
  btnDownload.disabled = true;
  const label = btnDownload.textContent;
  btnDownload.textContent = "Exporting…";

  try {
    const stickerImg = await loadExportLayers();

    const { expected, loaded } = countLoadedLayersInCache(selection, exportImageCache);
    if (expected > 0 && loaded === 0) {
      throw new Error("no layers loaded");
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = PREVIEW;
    exportCanvas.height = PREVIEW;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");

    drawComposite(ctx, selection, exportImageCache, stickerImg);

    const blob = await new Promise((resolve) => {
      exportCanvas.toBlob(resolve, "image/png");
    });
    if (!blob) {
      throw new Error("tainted canvas");
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drip-pfp-${selectionToSeed(selection)}.png`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[download]", err);
    let msg = "Download failed.\n\nHard refresh the page (Cmd+Shift+R) and try again.";
    if (err instanceof Error) {
      if (/fetch|CORS|Failed to load/i.test(err.message)) {
        msg = `${exportCorsSetupMessage()}\n\nDetails: ${err.message}`;
      } else if (err.message.startsWith("HTTP ")) {
        msg = `Download failed — image not found.\n\n${err.message}\n\nRefresh the page and try again.`;
      } else if (err.message.includes("layer(s) failed")) {
        msg = `Download failed — some layers did not load.\n\n${err.message}\n\nWait for the preview to finish, then try again.`;
      }
    } else if (err instanceof TypeError) {
      msg = exportCorsSetupMessage();
    }
    window.alert(msg);
  } finally {
    btnDownload.disabled = false;
    btnDownload.textContent = label;
  }
}

btnRandom?.addEventListener("click", randomize);
btnReset?.addEventListener("click", resetSelection);
btnDownload?.addEventListener("click", downloadPng);
btnCustomReset?.addEventListener("click", resetStickerPosition);

customOverlayScale?.addEventListener("input", () => {
  const v = Number.parseInt(customOverlayScale.value, 10);
  if (!Number.isFinite(v)) return;
  stickerOverlay = { ...stickerOverlay, scale: v / 100 };
  persistStickerOverlay();
  void renderPreview();
});

stickerRotation?.addEventListener("input", () => {
  const v = Number.parseInt(stickerRotation.value, 10);
  if (!Number.isFinite(v)) return;
  stickerOverlay = { ...stickerOverlay, rotation: v };
  if (stickerRotationValue) stickerRotationValue.textContent = `${v}°`;
  persistStickerOverlay();
  void renderPreview();
});

previewCanvas.addEventListener("wheel", (e) => {
  if (stickerOverlay.index <= 0 || !activeStickerImage) return;
  if (!e.shiftKey) return;
  e.preventDefault();
  const step = e.deltaY > 0 ? -5 : 5;
  stickerOverlay = {
    ...stickerOverlay,
    rotation: ((stickerOverlay.rotation + step) % 360 + 360) % 360,
  };
  persistStickerOverlay();
  syncStickerOverlayUi();
  void renderPreview();
}, { passive: false });

previewCanvas.addEventListener("pointerdown", (e) => {
  if (stickerOverlay.index <= 0 || !activeStickerImage) return;
  if (e.shiftKey) return;
  stickerDragging = true;
  previewCanvas.setPointerCapture(e.pointerId);
  const pt = normalizedPointFromPointer(e);
  stickerOverlay = { ...stickerOverlay, x: pt.x, y: pt.y };
  persistStickerOverlay();
  void renderPreview();
});

previewCanvas.addEventListener("pointermove", (e) => {
  if (!stickerDragging) return;
  const pt = normalizedPointFromPointer(e);
  stickerOverlay = { ...stickerOverlay, x: pt.x, y: pt.y };
  persistStickerOverlay();
  void renderPreview();
});

function endStickerDrag(e) {
  if (!stickerDragging) return;
  stickerDragging = false;
  try {
    previewCanvas.releasePointerCapture(e.pointerId);
  } catch {
    /* capture already released */
  }
}

previewCanvas.addEventListener("pointerup", endStickerDrag);
previewCanvas.addEventListener("pointercancel", endStickerDrag);
themeSwitch?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

seedInput.addEventListener("change", () => {
  void (async () => {
    const n = Number.parseInt(seedInput.value.replace(/\D/g, ""), 10);
    if (Number.isFinite(n)) {
      const seedCounts = { ...getCounts(), background: getBackgroundPickerCount() };
      selection = selectionFromSeed(n, seedCounts);
      clampSelection();
      renderThumbs();
      await renderPreview();
    } else {
      syncSeed();
    }
  })();
});

seedInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") seedInput.dispatchEvent(new Event("change"));
});

const btnSeedApply = document.getElementById("btnSeedApply");
btnSeedApply?.addEventListener("click", () => seedInput.dispatchEvent(new Event("change")));

backgroundColorInput?.addEventListener("input", () => {
  applyCustomBackgroundColor(backgroundColorInput.value);
});

backgroundColorHex?.addEventListener("change", () => {
  applyCustomBackgroundColor(backgroundColorHex.value);
});

backgroundColorHex?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") backgroundColorHex.dispatchEvent(new Event("change"));
});

stickerSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void applyStickerSearch();
});

const btnStickerSearchApply = document.getElementById("btnStickerSearchApply");
btnStickerSearchApply?.addEventListener("click", () => {
  void applyStickerSearch();
});

/** Random skin only; other trait layers and sticker start empty. */
function applyInitialState() {
  selection = { ...selection, skin: pickRandomSkinIndex() };
  stickerOverlay = defaultStickerOverlay();
  applyActiveStickerImage();
}

/** Remove old traits-proxy service workers that break CORS export. */
async function clearLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => /traits|dripster|sw/i.test(k)).map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
}

async function init() {
  await clearLegacyServiceWorkers();
  loadStoredCustomBackgroundColor();
  try {
    await Promise.all([loadTraitCatalog(), loadStickerCatalog()]);
  } catch (e) {
    console.error(e);
  }
  syncStickerSourceAccess();
  clampSelection();
  applyInitialState();
  clampSelection();
  clampCollabSelection();
  clampStickerSelection();
  persistStickerOverlay();
  syncStickerOverlayUi();
  syncBackgroundColorUi();
  syncStickerSearchUi();
  syncSeed();
  applyTheme(getInitialTheme());
  syncPreviewCanvasBackingStore();
  renderTabs();
  renderThumbs();
  await renderPreview();
  requestAnimationFrame(() => {
    requestAnimationFrame(syncPickerHeightToPreview);
  });
}

window.addEventListener("resize", () => {
  if (!thumbGrid?.classList.contains("thumb-grid--virtual")) return;
  scheduleRenderThumbs();
});

window.addEventListener("pagehide", () => releaseMobilePickerMemory());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseMobilePickerMemory();
});

init();
