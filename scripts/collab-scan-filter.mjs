/**
 * Exclude collab trait filenames from _scan.json (they appear via collab picker instead).
 */

import fs from "node:fs";
import path from "node:path";

export const COLLAB_SCAN_CATEGORIES = ["skin", "frame", "clothes", "hat", "accessories", "background"];

/** @returns {Partial<Record<string, Set<string>>>} */
export function loadCollabBlockedFilenames(projectRoot = process.cwd()) {
  const collabPath = path.join(projectRoot, "src", "collab-manifest.json");
  /** @type {Partial<Record<string, Set<string>>>} */
  const blocked = Object.fromEntries(COLLAB_SCAN_CATEGORIES.map((c) => [c, new Set()]));
  if (!fs.existsSync(collabPath)) return blocked;
  /** @type {Record<string, { traits?: Partial<Record<string, string[]>> }>} */
  const manifest = JSON.parse(fs.readFileSync(collabPath, "utf8"));
  for (const def of Object.values(manifest)) {
    for (const cat of COLLAB_SCAN_CATEGORIES) {
      const list = def?.traits?.[cat];
      if (!Array.isArray(list)) continue;
      for (const file of list) {
        if (typeof file === "string" && file) blocked[cat].add(file.toLowerCase());
      }
    }
  }
  return blocked;
}

/**
 * @param {Record<string, string[]>} scan
 * @param {string} [projectRoot]
 * @returns {Record<string, string[]>}
 */
/** @returns {Set<string>} All collab trait filenames (any category). */
export function allCollabBlockedFilenames(projectRoot = process.cwd()) {
  const blocked = loadCollabBlockedFilenames(projectRoot);
  /** @type {Set<string>} */
  const all = new Set();
  for (const set of Object.values(blocked)) {
    for (const file of set ?? []) all.add(file);
  }
  return all;
}

export function filterCollabFromScan(scan, projectRoot = process.cwd()) {
  const allBlocked = allCollabBlockedFilenames(projectRoot);
  if (!allBlocked.size) return { ...scan };
  /** @type {Record<string, string[]>} */
  const out = { ...scan };
  for (const [cat, list] of Object.entries(out)) {
    if (!Array.isArray(list)) continue;
    out[cat] = list.filter((f) => !allBlocked.has(String(f).toLowerCase()));
  }
  return out;
}
