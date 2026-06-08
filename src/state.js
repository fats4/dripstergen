/** @typedef {'background'|'clothes'|'glasses'|'hat'|'skin'} CategoryKey */

/** @type {readonly CategoryKey[]} */
export const CATEGORY_KEYS = [
  "skin",
  "clothes",
  "glasses",
  "hat",
  "background",
];

/**
 * Layer draw order (back → front). Differs from CATEGORY_KEYS (tab UI order).
 * Hat/hair under glasses so frames stay visible on top.
 */
export const COMPOSITE_ORDER = /** @type {readonly CategoryKey[]} */ ([
  "background",
  "skin",
  "clothes",
  "hat",
  "glasses",
]);

/** @type {Record<CategoryKey, string>} */
export const CATEGORY_LABELS = {
  background: "background",
  clothes: "clothes",
  glasses: "glasses",
  hat: "hat",
  skin: "skin",
};

/** Picker tabs: traits + extra stickers (not full-canvas composite layers) */
export const STICKERS_TAB = "stickers";

/** @typedef {CategoryKey | typeof STICKERS_TAB} PickerTabKey */

/** @type {readonly PickerTabKey[]} */
export const PICKER_TAB_KEYS = [...CATEGORY_KEYS, STICKERS_TAB];

/** @type {Record<PickerTabKey, string>} */
export const PICKER_TAB_LABELS = {
  ...CATEGORY_LABELS,
  [STICKERS_TAB]: "skrumpeys",
};

/** @typedef {Record<CategoryKey, number>} Counts */
/** @typedef {Record<CategoryKey, number>} Selection */

/** @returns {Selection} */
export function defaultSelection() {
  return {
    skin: 0,
    clothes: 0,
    glasses: 0,
    hat: 0,
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

/** @typedef {{ index: number; x: number; y: number; scale: number; rotation: number }} StickerOverlay */

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

/** index 0 = no sticker; 1+ = selection in stickers tab */
export function defaultStickerOverlay() {
  return {
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
  return {
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
