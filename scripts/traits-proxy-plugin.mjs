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

      console.log(`[traits-proxy] ${PROXY_PREFIX}/* → ${base} (dev only)`);
    },
  };
}
