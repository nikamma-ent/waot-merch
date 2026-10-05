import * as config from "./api/config.js";
import * as order from "./api/order.js";
import * as verify from "./api/verify.js";
import * as webhook from "./api/webhook.js";
import * as adminOrders from "./api/admin/orders.js";

// The backend. The site itself is static (GitHub Pages) and calls these routes.
const ROUTES = {
  "GET /api/config": config.onRequestGet,
  "POST /api/order": order.onRequestPost,
  "POST /api/verify": verify.onRequestPost,
  "POST /api/webhook": webhook.onRequestPost,
  "GET /api/admin/orders": adminOrders.onRequestGet,
};

// Browser-facing routes. The webhook and admin CSV aren't called from the site.
const CORS_PATHS = new Set(["/api/config", "/api/order", "/api/verify"]);

// ALLOWED_ORIGINS: comma-separated, e.g. "https://you.github.io,http://localhost:8788"
function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const cors = CORS_PATHS.has(pathname) ? corsHeaders(request, env) : {};

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const handler = ROUTES[`${request.method} ${pathname}`];
    if (!handler) return new Response("Not found", { status: 404 });

    let res;
    try {
      // Holding and releasing stock takes several database steps. waitUntil
      // lets them finish even if the buyer closes the page mid-request, so a
      // dropped connection can't leave tees stuck as "held".
      const work = handler({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
      ctx.waitUntil(work.catch(() => {}));
      res = await work;
    } catch (e) {
      console.error(e);
      res = Response.json({ error: "Something went wrong. Try again in a minute." }, { status: 500 });
    }
    if (!Object.keys(cors).length) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
