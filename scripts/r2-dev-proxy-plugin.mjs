import fs from "node:fs";
import path from "node:path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * @param {string} root
 */
function loadDotEnv(root) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

/**
 * Dev-only: serve `/traits/*` from R2 via S3 API when `*.r2.dev` is blocked (e.g. ISP DNS).
 * Active when R2 credentials exist and `VITE_ASSETS_BASE_URL` is empty or `R2_DEV_PROXY=true`.
 *
 * @param {string} projectRoot
 */
export function r2DevProxyPlugin(projectRoot) {
  return {
    name: "r2-dev-proxy",
    configureServer(server) {
      loadDotEnv(projectRoot);
      const accountId = process.env.R2_ACCOUNT_ID?.trim();
      const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
      const bucket = process.env.R2_BUCKET?.trim();
      if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return;

      const explicitBase = (process.env.VITE_ASSETS_BASE_URL ?? "").trim();
      const forceProxy = process.env.R2_DEV_PROXY === "true";
      if (explicitBase && !forceProxy) return;

      const client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      const prefix = (process.env.R2_KEY_PREFIX ?? "traits").replace(/^\/+|\/+$/g, "");

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const pathOnly = req.url?.split("?")[0];
        if (!pathOnly?.startsWith("/traits/")) return next();

        const rel = pathOnly.slice("/traits/".length);
        const key = prefix ? `${prefix}/${rel}` : rel;

        try {
          const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          if (out.ContentType) res.setHeader("Content-Type", out.ContentType);
          res.setHeader("Cache-Control", "no-store");
          if (req.method === "HEAD") {
            res.statusCode = 200;
            res.end();
            return;
          }
          const bytes = await out.Body.transformToByteArray();
          res.end(Buffer.from(bytes));
        } catch {
          next();
        }
      });

      console.log(`[r2-dev-proxy] /traits/* → R2 bucket "${bucket}"`);
    },
  };
}
