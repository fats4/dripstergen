import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { r2DevProxyPlugin } from "./scripts/r2-dev-proxy-plugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Matches trait categories in src/state.js (no import to keep config lightweight) */
const TRAIT_CATEGORIES = ["skin", "clothes", "glasses", "hat", "background", "stickers"];
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
  return out;
}

function traitsPublicScanPlugin() {
  return {
    name: "traits-public-scan",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = req.url?.split("?")[0];
        if (pathOnly === "/traits/_scan.json") {
          const body = JSON.stringify(scanPublicTraits(process.cwd()));
          res.setHeader("Content-Type", "application/json");
          res.end(body);
          return;
        }
        next();
      });
    },
    writeBundle(outputOptions) {
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
  plugins: [r2DevProxyPlugin(__dirname), traitsPublicScanPlugin()],
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
