/** Internal export / download resolution — always full quality */
export const EXPORT_CANVAS_PX = 1024;

/** @typedef {'high' | 'medium' | 'low'} DisplayTier */

/**
 * Desktop = high; coarse pointer / narrow viewport = medium; `?quality=low` for testing.
 * @returns {DisplayTier}
 */
export function displayTier() {
  if (typeof window === "undefined") return "high";
  const q = new URLSearchParams(window.location.search).get("quality");
  if (q === "low" || q === "medium" || q === "high") return q;
  if (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768) return "medium";
  return "high";
}

/**
 * Preview canvas backing store (not export).
 * @param {DisplayTier} [tier]
 * @returns {number}
 */
export function previewCanvasPx(tier = displayTier()) {
  if (tier === "low") return 480;
  if (tier === "medium") return 640;
  return EXPORT_CANVAS_PX;
}

/**
 * Cap decoded bitmap size for preview/picker when full-res assets are loaded.
 * @param {DisplayTier} [tier]
 * @returns {number | null} null = no cap (full decode)
 */
export function maxDecodePxForPreview(tier = displayTier()) {
  if (tier === "high") return null;
  if (tier === "medium") return 640;
  return 480;
}

/**
 * @param {DisplayTier} [tier]
 * @returns {number}
 */
export function previewImageCacheMax(tier = displayTier()) {
  if (tier === "high") return 300;
  if (tier === "medium") return 120;
  return 80;
}

/**
 * Max thumb grid canvas buffer edge (logical THUMB is scaled by DPR).
 * @param {DisplayTier} [tier]
 * @returns {number | null}
 */
export function thumbBufferMaxPx(tier = displayTier()) {
  if (tier === "high") return null;
  if (tier === "medium") return 192;
  return 144;
}
