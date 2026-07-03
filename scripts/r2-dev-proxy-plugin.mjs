import fs from "node:fs";
import path from "node:path";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

/**
 * @param {string} root
 */
export function loadDotEnv(root) {
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

/** @param {NodeJS.ProcessEnv} [env] */
export function hasR2Credentials(env = process.env) {
  return !!(
    env.R2_ACCOUNT_ID?.trim() &&
    env.R2_ACCESS_KEY_ID?.trim() &&
    env.R2_SECRET_ACCESS_KEY?.trim() &&
    env.R2_BUCKET?.trim()
  );
}

/**
 * Dev should load traits from R2 (via proxy) when credentials exist.
 * Opt out: VITE_R2_DEV_TRAITS=false
 * @param {NodeJS.ProcessEnv} [env]
 */
export function shouldUseR2TraitsInDev(env = process.env) {
  if (!hasR2Credentials(env)) return false;
  const flag = (env.VITE_R2_DEV_TRAITS ?? "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

/**
 * Dev-only: serve `/traits/*` from R2 via S3 API (same-origin, no CDN CORS in dev).
 * Active when R2 credentials exist and `VITE_R2_DEV_TRAITS` is not `false`.
 *
 * @param {string} projectRoot
 */
export function r2DevProxyPlugin(projectRoot) {
  return {
    name: "r2-dev-proxy",
    configureServer(server) {
      loadDotEnv(projectRoot);
      if (!hasR2Credentials(process.env)) return;

      if (!shouldUseR2TraitsInDev(process.env)) return;

      const accountId = process.env.R2_ACCOUNT_ID.trim();
      const accessKeyId = process.env.R2_ACCESS_KEY_ID.trim();
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY.trim();
      const bucket = process.env.R2_BUCKET.trim();

      const client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      const prefix = (process.env.R2_KEY_PREFIX ?? "traits").replace(/^\/+|\/+$/g, "");
      const IMAGE_EXT = /\.(png|webp|jpe?g|svg)$/i;
      const DEV_MONIGGA_STICKERS_PATH = "/traits/_dev-monigga-stickers.json";

      /**
       * @param {S3Client} s3
       * @param {string} bucketName
       * @param {string} keyPrefix
       * @param {string} category
       */
      async function listCategoryFilenames(s3, bucketName, keyPrefix, category) {
        const catPrefix = keyPrefix ? `${keyPrefix}/${category}/` : `${category}/`;
        /** @type {string[]} */
        const files = [];
        let token;
        do {
          const out = await s3.send(
            new ListObjectsV2Command({
              Bucket: bucketName,
              Prefix: catPrefix,
              ContinuationToken: token,
            }),
          );
          for (const obj of out.Contents ?? []) {
            if (!obj.Key || obj.Key.endsWith("/")) continue;
            const file = obj.Key.slice(catPrefix.length);
            if (!IMAGE_EXT.test(file)) continue;
            files.push(file);
          }
          token = out.IsTruncated ? out.NextContinuationToken : undefined;
        } while (token);
        return files.sort((a, b) => a.localeCompare(b));
      }

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const pathOnly = req.url?.split("?")[0];
        if (pathOnly === DEV_MONIGGA_STICKERS_PATH) {
          try {
            const files = await listCategoryFilenames(client, bucket, prefix, "monigga");
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            if (req.method === "HEAD") {
              res.statusCode = 200;
              res.end();
              return;
            }
            res.end(`${JSON.stringify(files)}\n`);
          } catch {
            next();
          }
          return;
        }
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
      console.log(`[r2-dev-proxy] dev-only monigga stickers → ${DEV_MONIGGA_STICKERS_PATH}`);
    },
  };
}
