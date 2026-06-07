/**
 * Cloudflare Worker — attach to route: assets.mondrips.com/*
 *
 * Adds CORS headers so driplab.mondrips.com can export PNG from canvas.
 * (R2 bucket CORS API may be blocked; this works at the CDN edge.)
 *
 * Deploy: Cloudflare Dashboard → Workers → Create → paste this →
 *   Triggers: Custom domain assets.mondrips.com
 * Or: Workers Routes → assets.mondrips.com/* → this worker
 */

const ALLOWED = new Set([
  "https://driplab.mondrips.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    const origin = request.headers.get("Origin") ?? "";
    const allowOrigin = ALLOWED.has(origin) ? origin : "https://driplab.mondrips.com";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowOrigin),
      });
    }

    const response = await fetch(request);
    const headers = new Headers(response.headers);
    for (const [k, v] of corsHeaders(allowOrigin)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },
};

/**
 * @param {string} allowOrigin
 * @returns {Map<string, string>}
 */
function corsHeaders(allowOrigin) {
  return new Map([
    ["Access-Control-Allow-Origin", allowOrigin],
    ["Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"],
    ["Access-Control-Allow-Headers", "*"],
    ["Access-Control-Max-Age", "86400"],
  ]);
}
