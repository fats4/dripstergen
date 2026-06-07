import fs from "node:fs";
import path from "node:path";

const PROXY_PREFIX = "/traits-proxy";

/**
 * Same-origin proxy for remote trait images — enables canvas export without R2 CORS.
 * Dev: Vite middleware. Production: service worker generated at build.
 *
 * @param {string} projectRoot
 */
export function traitsProxyPlugin(projectRoot) {
  const assetsBase = () =>
    (process.env.VITE_ASSETS_BASE_URL ?? "").trim().replace(/\/+$/, "");

  function remoteUrl(pathname) {
    const base = assetsBase();
    if (!base) return null;
    if (!pathname.startsWith(`${PROXY_PREFIX}/`)) return null;
    return `${base}${pathname.slice(PROXY_PREFIX.length)}`;
  }

  function swSource(base) {
    return `/* generated — do not edit */
const ASSETS_BASE = ${JSON.stringify(base)};
const PROXY_PREFIX = ${JSON.stringify(PROXY_PREFIX)};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(PROXY_PREFIX + "/")) return;
  const remote = ASSETS_BASE + url.pathname.slice(PROXY_PREFIX.length);
  event.respondWith(
    fetch(remote).then((res) => {
      if (!res.ok) return res;
      const headers = new Headers(res.headers);
      if (!headers.get("Content-Type")) {
        const ext = url.pathname.split(".").pop()?.toLowerCase();
        const mime = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", json: "application/json" };
        if (ext && mime[ext]) headers.set("Content-Type", mime[ext]);
      }
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }),
  );
});
`;
  }

  return {
    name: "traits-proxy",
    configureServer(server) {
      const base = assetsBase();
      if (!base) return;

      server.middlewares.use(async (req, res, next) => {
        const pathOnly = req.url?.split("?")[0];
        const remote = pathOnly ? remoteUrl(pathOnly) : null;
        if (!remote) return next();

        try {
          const upstream = await fetch(remote, { method: req.method === "HEAD" ? "HEAD" : "GET" });
          res.statusCode = upstream.status;
          const ct = upstream.headers.get("content-type");
          if (ct) res.setHeader("Content-Type", ct);
          res.setHeader("Cache-Control", "public, max-age=3600");
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.end(buf);
        } catch {
          next();
        }
      });

      console.log(`[traits-proxy] ${PROXY_PREFIX}/* → ${base}`);
    },
    writeBundle(outputOptions) {
      const base = assetsBase();
      if (!base) return;
      const outDir = outputOptions.dir ?? path.join(projectRoot, "dist");
      fs.writeFileSync(path.join(outDir, "sw-traits-proxy.js"), swSource(base), "utf8");
    },
  };
}
