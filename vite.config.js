import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { filterCollabFromScan } from "./scripts/collab-scan-filter.mjs";
import {
  loadDotEnv,
  r2DevProxyPlugin,
  shouldUseR2TraitsInDev,
} from "./scripts/r2-dev-proxy-plugin.mjs";
import { traitsProxyPlugin } from "./scripts/traits-proxy-plugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(__dirname);
const useR2TraitsInDev = shouldUseR2TraitsInDev(process.env);

/** Matches trait categories in src/state.js (no import to keep config lightweight) */
const TRAIT_CATEGORIES = ["skin", "frame", "accessories", "clothes", "glasses", "hat", "background", "stickers", "monigga", "roarnads"];
const TRAIT_EXT = /\.(png|webp|jpe?g|svg)$/i;

/**
 * One file per basename; prefer webp > png > jpg > svg (size & speed).
 * @param {string[]} files
 * @returns {string[]}
 */
function preferTraitFilenames(files) {
  /** @type {Map<string, { name: string; rank: number }>} */
  const best = new Map();
  for (const f of files) {
    if (!TRAIT_EXT.test(f) || f === "manifest.json") continue;
    const ext = path.extname(f).toLowerCase();
    const base = f.slice(0, -ext.length);
    const rank =
      ext === ".webp" ? 0 : ext === ".png" ? 1 : ext === ".jpg" || ext === ".jpeg" ? 2 : ext === ".svg" ? 3 : 9;
    const prev = best.get(base);
    if (!prev || rank < prev.rank) {
      best.set(base, { name: f, rank });
    }
  }
  return [...best.values()]
    .map((x) => x.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Scan `public/traits/<category>/` so assets need not be listed manually in manifest.
 * @param {string} projectRoot
 * @returns {Record<string, string[]>}
 */
function scanPublicTraits(projectRoot) {
  const base = path.join(projectRoot, "public", "traits");
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const cat of TRAIT_CATEGORIES) {
    const dir = path.join(base, cat);
    try {
      const raw = fs.readdirSync(dir).filter((f) => !f.startsWith(".") && f !== "manifest.json");
      out[cat] = preferTraitFilenames(raw);
    } catch {
      out[cat] = [];
    }
  }
  return filterCollabFromScan(out, projectRoot);
}

function traitsPublicScanPlugin(/** @type {{ devScan?: boolean; buildScan?: boolean }} */ options = {}) {
  const { devScan = true, buildScan = true } = options;
  return {
    name: "traits-public-scan",
    configureServer(server) {
      if (!devScan) return;
      server.middlewares.use((req, res, next) => {
        const pathOnly = req.url?.split("?")[0];
        if (pathOnly === "/traits/_scan.json") {
          const body = JSON.stringify(scanPublicTraits(process.cwd()));
          res.setHeader("Content-Type", "application/json");
          res.end(body);
          return;
        }
        if (pathOnly === "/traits/_dev-roarnads-stickers.json") {
          const scan = scanPublicTraits(process.cwd());
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(`${JSON.stringify(scan.roarnads ?? [])}\n`);
          return;
        }
        next();
      });
    },
    writeBundle(outputOptions) {
      if (!buildScan) return;
      const outDir = outputOptions.dir ?? path.join(__dirname, "dist");
      const traitsDir = path.join(outDir, "traits");
      try {
        fs.mkdirSync(traitsDir, { recursive: true });
        fs.writeFileSync(
          path.join(traitsDir, "_scan.json"),
          JSON.stringify(scanPublicTraits(process.cwd())),
          "utf8",
        );
      } catch {
        /* build without dist */
      }
    },
  };
}

/**
 * GitHub Pages base path.
 * - Custom domain (root):  "/"           e.g. https://gen.dripster.xyz/
 * - Project site:          "/dripstergen/" e.g. https://user.github.io/dripstergen/
 * Override via GH_PAGES_BASE in CI or: GH_PAGES_BASE=/ npm run build:pages
 */
const GH_PAGES_BASE = (process.env.GH_PAGES_BASE ?? "/dripstergen/").trim() || "/";

export default defineConfig({
  base: process.env.GH_PAGES === "true" ? GH_PAGES_BASE : "/",
  root: ".",
  publicDir: "public",
  env: {
    VITE_R2_DEV_TRAITS: useR2TraitsInDev ? "true" : "",
  },
  plugins: [
    r2DevProxyPlugin(__dirname),
    traitsProxyPlugin(__dirname),
    traitsPublicScanPlugin({ devScan: !useR2TraitsInDev, buildScan: true }),
  ],
  server: {
    /** Access via ngrok / tunnel (Host header changes per URL) */
    host: true,
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
