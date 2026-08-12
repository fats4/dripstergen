/** @typedef {'background'|'frame'|'skin'|'clothes'|'glasses'|'hat'|'accessories'} CategoryKey */

/** @typedef {Partial<Record<CategoryKey, string | string[]>>} TraitLockWhen */

/** @typedef {{ when: TraitLockWhen; block: Partial<Record<CategoryKey, string[]>> }} CollabTraitLockRule */

/** @typedef {{ label: string; accent: string; traits: Partial<Record<CategoryKey, string[]>>; traitLocks?: CollabTraitLockRule[] }} CollabPartnerDef */

/** @type {readonly CategoryKey[]} */
export const CATEGORY_KEYS = [
  "skin",
  "clothes",
  "glasses",
  "hat",
  "frame",
  "accessories",
  "background",
];

/**
 * Layer draw order (back → front). Differs from CATEGORY_KEYS (tab UI order).
 * Frame sits above background but under body; accessories on top of wearable layers.
 */
export const COMPOSITE_ORDER = /** @type {readonly CategoryKey[]} */ ([
  "background",
  "frame",
  "skin",
  "clothes",
  "hat",
  "glasses",
  "accessories",
]);

/** @type {Record<CategoryKey, string>} */
export const CATEGORY_LABELS = {
  background: "background",
  frame: "frame",
  clothes: "clothes",
  glasses: "glasses",
  hat: "hat",
  skin: "skin",
  accessories: "accessories",
};

/** Picker tabs: traits + sticker overlay picker */
export const STICKERS_TAB = "stickers";

/** Layer categories that can include collab variants (shown in the same tab with card styling) */
export const COLLAB_LAYER_KEYS = /** @type {readonly CategoryKey[]} */ ([
  "skin",
  "frame",
  "clothes",
  "hat",
  "accessories",
  "background",
]);

/** MONIGGA collab off in production by default; dev on. Opt-in: VITE_ENABLE_MONIGGA_COLLAB=true */
function isMoniggaCollabDefaultEnabled() {
  const all = (import.meta.env.VITE_ENABLE_MONIGGA_COLLAB ?? "").trim().toLowerCase();
  if (all === "true" || all === "1") return true;
  if (all === "false" || all === "0") return false;
  return import.meta.env.DEV;
}

/** Collab traits (clothes/hat). Override: VITE_ENABLE_COLLAB_TRAITS=true|false */
export function isCollabTraitsEnabled() {
  const flag = (import.meta.env.VITE_ENABLE_COLLAB_TRAITS ?? "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return isMoniggaCollabDefaultEnabled();
}

/** Skin collab tile. Override: VITE_ENABLE_COLLAB_SKIN=true|false */
export function isCollabSkinEnabled() {
  const flag = (import.meta.env.VITE_ENABLE_COLLAB_SKIN ?? "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return isMoniggaCollabDefaultEnabled();
}

/** @param {CategoryKey} cat */
export function isCollabCategoryEnabled(cat) {
  if (cat === "skin") return isCollabSkinEnabled();
  if (cat === "frame" || cat === "clothes" || cat === "hat" || cat === "accessories" || cat === "background") {
    return isCollabTraitsEnabled();
  }
  return false;
}

/** Monigga sticker sub-tab. Override: VITE_ENABLE_MONIGGA_STICKERS=true|false */
export function isMoniggaStickersEnabled() {
  const flag = (import.meta.env.VITE_ENABLE_MONIGGA_STICKERS ?? "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return isMoniggaCollabDefaultEnabled();
}

/** RoarNads sticker sub-tab. Override: VITE_ENABLE_ROARNADS_STICKERS=true|false */
export function isRoarnadsStickersEnabled() {
  const flag = (import.meta.env.VITE_ENABLE_ROARNADS_STICKERS ?? "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return import.meta.env.DEV;
}

/** @typedef {'skrumpeys'|'monigga'|'roarnads'} StickerSourceKey */

/** @type {readonly StickerSourceKey[]} */
export const STICKER_SOURCE_KEYS = ["skrumpeys", "monigga", "roarnads"];

/** @type {Record<StickerSourceKey, string>} */
export const STICKER_SOURCE_LABELS = {
  skrumpeys: "skrumpeys",
  monigga: "monigga",
  roarnads: "roarnads",
};

/** @returns {readonly StickerSourceKey[]} */
export function getStickerSourceKeys() {
  /** @type {StickerSourceKey[]} */
  const keys = ["skrumpeys"];
  if (isMoniggaStickersEnabled()) keys.push("monigga");
  if (isRoarnadsStickersEnabled()) keys.push("roarnads");
  return keys;
}

/** @typedef {CategoryKey | typeof STICKERS_TAB} PickerTabKey */

/** @type {readonly PickerTabKey[]} */
export const PICKER_TAB_KEYS = [...CATEGORY_KEYS, STICKERS_TAB];

/** @type {Record<PickerTabKey, string>} */
export const PICKER_TAB_LABELS = {
  ...CATEGORY_LABELS,
  [STICKERS_TAB]: "sticker",
};

/** @typedef {string} CollabPartnerKey */

/** @typedef {typeof COLLAB_LAYER_KEYS[number]} CollabLayerKey */

/** @typedef {{
 *   skin: number;
 *   frame: number;
 *   clothes: number;
 *   hat: number;
 *   accessories: number;
 *   background: number;
 *   partner: Partial<Record<CollabLayerKey, string>>;
 * }} CollabSelection */

/** @returns {CollabSelection} */
export function defaultCollabSelection() {
  return { skin: 0, frame: 0, clothes: 0, hat: 0, accessories: 0, background: 0, partner: {} };
}

/** @typedef {Record<CategoryKey, number>} Counts */
/** @typedef {Record<CategoryKey, number>} Selection */

/** @returns {Selection} */
export function defaultSelection() {
  return {
    skin: 0,
    clothes: 0,
    glasses: 0,
    hat: 0,
    frame: 0,
    accessories: 0,
    background: 0,
  };
}

/**
 * @param {number} seed
 * @param {Counts} counts
 * @returns {Selection}
 */
export function selectionFromSeed(seed, counts) {
  let x = Math.floor(Math.abs(seed)) % 2147483647 || 1;
  /** @type {Selection} */
  const s = { ...defaultSelection() };
  for (const key of CATEGORY_KEYS) {
    x = (x * 48271) % 2147483647;
    /** background: counts usually exclude custom color slot (none + images only) */
    if (key === "skin" && counts[key] > 1) {
      s[key] = 1 + (x % (counts[key] - 1));
      continue;
    }
    const n = Math.max(1, counts[key]);
    s[key] = x % n;
  }
  return s;
}

/**
 * @param {Selection} sel
 * @returns {number}
 */
export function selectionToSeed(sel) {
  let h = 0;
  for (const key of CATEGORY_KEYS) {
    h = (h * 31 + sel[key]) >>> 0;
  }
  return h % 1000000;
}

/** @typedef {{ source: StickerSourceKey; index: number; x: number; y: number; scale: number; rotation: number }} StickerOverlay */

/**
 * @param {number} deg
 * @returns {number}
 */
export function normalizeRotation(deg) {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

export const CUSTOM_OVERLAY_STORAGE_KEY = "dripster-custom-overlay";
export const CUSTOM_BG_COLOR_STORAGE_KEY = "dripster-custom-bg-color";

/** @returns {string} */
export function defaultCustomBackgroundColor() {
  return "#6366f1";
}

/**
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeHexColor(input) {
  let s = String(input).trim();
  if (!s.startsWith("#")) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    s = `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  return null;
}

/** index 0 = no sticker; 1+ = selection in active sticker sub-tab catalog */
export function defaultStickerOverlay() {
  return {
    source: /** @type {StickerSourceKey} */ ("skrumpeys"),
    index: 0,
    x: 0.5,
    y: 0.78,
    scale: 0.45,
    rotation: 0,
  };
}

/**
 * @param {StickerOverlay} o
 * @param {number} maxIndex
 * @returns {StickerOverlay}
 */
export function clampStickerOverlay(o, maxIndex) {
  const max = Math.max(0, maxIndex);
  return {
    ...o,
    index: Math.min(max, Math.max(0, Math.floor(o.index))),
    rotation: normalizeRotation(o.rotation),
  };
}

/**
 * @param {unknown} raw
 * @returns {StickerOverlay}
 */
export function parseStoredStickerOverlay(raw) {
  const base = defaultStickerOverlay();
  if (!raw || typeof raw !== "object") return base;
  const o = /** @type {Record<string, unknown>} */ (raw);
  let index = base.index;
  if (typeof o.index === "number" && Number.isFinite(o.index)) {
    index = Math.max(0, Math.floor(o.index));
  } else if (o.enabled === true) {
    index = 1;
  }
  const source =
    o.source === "monigga" || o.source === "skrumpeys" || o.source === "roarnads"
      ? /** @type {StickerSourceKey} */ (o.source)
      : base.source;
  return {
    source,
    index,
    x: typeof o.x === "number" && Number.isFinite(o.x) ? Math.min(1, Math.max(0, o.x)) : base.x,
    y: typeof o.y === "number" && Number.isFinite(o.y) ? Math.min(1, Math.max(0, o.y)) : base.y,
    scale:
      typeof o.scale === "number" && Number.isFinite(o.scale)
        ? Math.min(1.2, Math.max(0.12, o.scale))
        : base.scale,
    rotation:
      typeof o.rotation === "number" && Number.isFinite(o.rotation)
        ? normalizeRotation(o.rotation)
        : base.rotation,
  };
}
