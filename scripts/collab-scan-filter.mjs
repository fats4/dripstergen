/**
 * Exclude collab trait filenames from _scan.json (they appear via collab picker instead).
 */

import fs from "node:fs";
import path from "node:path";

export const COLLAB_SCAN_CATEGORIES = ["skin", "clothes", "hat"];

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
export function filterCollabFromScan(scan, projectRoot = process.cwd()) {
  const blocked = loadCollabBlockedFilenames(projectRoot);
  /** @type {Record<string, string[]>} */
  const out = { ...scan };
  for (const cat of COLLAB_SCAN_CATEGORIES) {
    const set = blocked[cat];
    if (!set?.size || !Array.isArray(out[cat])) continue;
    out[cat] = out[cat].filter((f) => !set.has(f.toLowerCase()));
  }
  return out;
}
