import dashboardHtml from "./dashboard.html";
import { cloudflareMetrics } from "./cloudflare";
import geo from "./geo.json";

// Map data for the dashboard globe, inlined once (JSON is inert inside a type="application/json" script).
const GEO_JSON = JSON.stringify(geo).replace(/</g, "\\u003c");
import { history } from "./history";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { buildServer, SERVER_NAME, SERVER_VERSION, type CallLog } from "./server";
import { dataset, products, CATEGORIES } from "./pricing";
import type { Env } from "./types";
import { landingPage } from "./landing";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

function withCors(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

/** Extract MCP client name/version from an initialize request so we can see which agents use the server. */
function clientFromBody(body: unknown): { name?: string; version?: string; method?: string } {
  const msgs = Array.isArray(body) ? body : [body];
  for (const m of msgs) {
    if (m && typeof m === "object" && "method" in m) {
      const method = (m as { method: string }).method;
      const info = (m as { params?: { clientInfo?: { name?: string; version?: string } } }).params?.clientInfo;
      if (method === "initialize") return { name: info?.name, version: info?.version, method };
      return { method };
    }
  }
  return {};
}

interface RequestMeta {
  rpc_method: string | null;
  protocol_version: string | null;
  adjusted: string[];
}

/**
 * Be liberal in what we accept: a client that is newer than our SDK (unknown protocol version header)
 * or that only advertises one of the two Accept types still gets served instead of a 400/406.
 */
function normaliseRequest(request: Request, meta: RequestMeta): Request {
  const headers = new Headers(request.headers);
  let changed = false;
  const pv = headers.get("mcp-protocol-version");
  if (pv && !SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) {
    headers.set("mcp-protocol-version", LATEST_PROTOCOL_VERSION);
    meta.adjusted.push(`protocol ${pv} -> ${LATEST_PROTOCOL_VERSION}`);
    changed = true;
  }
  const accept = headers.get("accept") ?? "";
  if (request.method === "POST" && !(accept.includes("application/json") && accept.includes("text/event-stream"))) {
    headers.set("accept", "application/json, text/event-stream");
    meta.adjusted.push(`accept '${accept.slice(0, 40)}'`);
    changed = true;
  }
  return changed ? new Request(request, { headers }) : request;
}

async function logFailure(env: Env, request: Request, response: Response, meta: RequestMeta): Promise<void> {
  if (!env.DB) return;
  let message = "";
  try {
    const body = (await response.clone().json()) as { error?: { message?: string } };
    message = body.error?.message ?? "";
  } catch {
    message = (await response.clone().text().catch(() => "")).slice(0, 200);
  }
  const country = (request as unknown as { cf?: { country?: string } }).cf?.country ?? null;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS errors (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, method TEXT, status INTEGER, message TEXT, rpc_method TEXT, protocol_version TEXT, user_agent TEXT, country TEXT)",
    ),
    env.DB.prepare("INSERT INTO errors (ts, method, status, message, rpc_method, protocol_version, user_agent, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
      new Date().toISOString(),
      request.method,
      response.status,
      message.slice(0, 300),
      meta.rpc_method,
      meta.protocol_version,
      (request.headers.get("user-agent") ?? "").slice(0, 200),
      country,
    ),
  ]);
}

/** Requests from our own test suite carry this header and are never logged, so they don't skew /stats. */
const TEST_HEADER = "x-smoke-test";

async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.headers.get(TEST_HEADER) === "1") env = { ...env, DB: undefined };
  const meta: RequestMeta = { rpc_method: null, protocol_version: request.headers.get("mcp-protocol-version"), adjusted: [] };
  const response = await handleMcpInner(request, env, ctx, meta);
  // GET -> 405 is normal: standard clients probe for an SSE stream, then fall back to POST. Don't log it.
  const expected = response.status === 405 && request.method === "GET";
  if (response.status >= 400 && !expected) ctx.waitUntil(logFailure(env, request, response, meta).catch((e) => console.error("log failure failed", e)));
  if (meta.adjusted.length) console.log("normalised request:", meta.adjusted.join("; "), request.headers.get("user-agent"));
  return response;
}

async function handleMcpInner(request: Request, env: Env, ctx: ExecutionContext, meta: RequestMeta): Promise<Response> {
  if (request.method === "GET" || request.method === "DELETE") {
    // Stateless server: no standalone SSE stream or sessions.
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to this endpoint." }, id: null }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  let parsed: unknown;
  try {
    parsed = await request.clone().json();
  } catch {
    parsed = undefined;
  }
  const ua = request.headers.get("user-agent") ?? "";
  const country = (request as unknown as { cf?: { country?: string } }).cf?.country ?? null;
  const client = clientFromBody(parsed);
  meta.rpc_method = client.method ?? null;
  request = normaliseRequest(request, meta);
  const started = Date.now();
  const logs: CallLog[] = [];

  if (client.method === "initialize" && env.DB) {
    ctx.waitUntil(
      env.DB.prepare("INSERT INTO sessions (ts, client_name, client_version, user_agent, country) VALUES (?, ?, ?, ?, ?)")
        .bind(new Date().toISOString(), client.name ?? null, client.version ?? null, ua.slice(0, 200), country)
        .run()
        .catch((e) => console.error("log session failed", e)),
    );
  }

  const server = buildServer(
    (entry) => logs.push(entry),
    async (f) => {
      if (!env.DB) return;
      await env.DB.prepare("INSERT INTO feedback (ts, product, plan, details, suggested_price, user_agent) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(new Date().toISOString(), f.product, f.plan ?? null, f.details, f.suggested_price ?? null, ua.slice(0, 200))
        .run();
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request, { parsedBody: parsed });

  if (env.DB && logs.length) {
    const ms = Date.now() - started;
    const stmts = logs.map((l) =>
      env.DB!.prepare(
        "INSERT INTO calls (ts, tool, products_requested, products_missing, args, ok, ms, user_agent, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(new Date().toISOString(), l.tool, l.products_requested.join(","), l.products_missing.join(","), JSON.stringify(l.args).slice(0, 500), l.ok ? 1 : 0, ms, ua.slice(0, 200), country),
    );
    ctx.waitUntil(env.DB.batch(stmts).catch((e) => console.error("log calls failed", e)));
  }
  ctx.waitUntil(server.close().catch(() => undefined));
  return response;
}

/** The browser dashboard. It holds no data itself: its script asks for the key, then fetches /stats?format=json with it. */
function dashboardResponse(): Response {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  return new Response(dashboardHtml.split("__GEO__").join(GEO_JSON).split("__NONCE__").join(nonce), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Only this page's own script and styles may run, and it may only talk to this server.
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

function authorised(request: Request, env: Env): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const key = new URL(request.url).searchParams.get("key");
  return !!env.STATS_KEY && (auth === `Bearer ${env.STATS_KEY}` || key === env.STATS_KEY);
}
const unauthorised = () => new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });

// ---- live traffic counter: one upsert per request into a per-minute row ----
let trafficReady: Promise<unknown> | null = null;
function ensureTraffic(db: D1Database): Promise<unknown> {
  trafficReady ??= db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS traffic (minute TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, mcp INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE INDEX IF NOT EXISTS traffic_requests ON traffic (requests)"),
  ]).catch((e) => { trafficReady = null; throw e; });
  return trafficReady;
}
function recordTraffic(request: Request, url: URL, status: number, env: Env, ctx: ExecutionContext): void {
  // Not counted: our own test traffic, and the dashboard's own requests (it would measure itself).
  if (!env.DB || request.headers.get(TEST_HEADER) === "1" || url.pathname.startsWith("/stats")) return;
  const db = env.DB;
  const minute = new Date().toISOString().slice(0, 16);
  const isMcp = url.pathname === "/mcp" || url.pathname === "/mcp/" ? 1 : 0;
  ctx.waitUntil(
    ensureTraffic(db)
      .then(() => db.prepare("INSERT INTO traffic (minute, requests, errors, mcp) VALUES (?1, 1, ?2, ?3) ON CONFLICT(minute) DO UPDATE SET requests = requests + 1, errors = errors + ?2, mcp = mcp + ?3").bind(minute, status >= 400 ? 1 : 0, isMcp).run())
      .catch((e) => console.error("traffic count failed", e)),
  );
}

/** Per-minute traffic for the live chart. With ?since=<minute> it returns only newer rows, so frequent polling stays cheap. */
async function live(request: Request, env: Env): Promise<Response> {
  if (!authorised(request, env)) return unauthorised();
  if (!env.DB) return Response.json({ error: "No D1 database bound" }, { status: 500 });
  await ensureTraffic(env.DB);
  const url = new URL(request.url);
  const minutes = Math.min(Math.max(Number(url.searchParams.get("minutes")) || 60, 5), 1440);
  const since = url.searchParams.get("since");
  const from = since && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(since) ? since : new Date(Date.now() - (minutes - 1) * 60_000).toISOString().slice(0, 16);
  const [rows, peak] = await Promise.all([
    env.DB.prepare("SELECT minute, requests, errors, mcp FROM traffic WHERE minute >= ? ORDER BY minute").bind(from).all(),
    env.DB.prepare("SELECT minute, requests FROM traffic ORDER BY requests DESC LIMIT 1").first(),
  ]);
  return Response.json({ now: new Date().toISOString(), from, per_minute: rows.results, peak: peak ?? null }, { headers: { "Cache-Control": "no-store" } });
}

// Highest-ever daily figures, for colouring each measure against its own record. These scan whole
// tables, so they're cached per isolate for 10 minutes.
let peaksCache: { at: number; value: Record<string, number> } | null = null;
async function allTimePeaks(db: D1Database): Promise<Record<string, number>> {
  if (peaksCache && Date.now() - peaksCache.at < 600_000) return peaksCache.value;
  await ensureTraffic(db);
  const one = async (sql: string) => Number(((await db.prepare(sql).first()) as { n?: number } | null)?.n ?? 0);
  const [calls, sessions, requests, minute] = await Promise.all([
    one("SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM calls GROUP BY substr(ts, 1, 10))"),
    one("SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM sessions GROUP BY substr(ts, 1, 10))"),
    one("SELECT MAX(n) AS n FROM (SELECT SUM(requests) AS n FROM traffic GROUP BY substr(minute, 1, 10))"),
    one("SELECT MAX(requests) AS n FROM traffic"),
  ]);
  const value = { calls_per_day: calls, sessions_per_day: sessions, requests_per_day: requests, requests_per_minute: minute };
  peaksCache = { at: Date.now(), value };
  return value;
}

async function stats(request: Request, env: Env): Promise<Response> {
  if (!authorised(request, env)) return unauthorised();
  if (!env.DB) return Response.json({ error: "No D1 database bound" }, { status: 500 });
  const days = Math.min(Number(new URL(request.url).searchParams.get("days") ?? 7) || 7, 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const q = async (sql: string) => (await env.DB!.prepare(sql).bind(since).all()).results;
  const cloudflare = cloudflareMetrics(env, days, new URL(request.url).host);
  const peaks = allTimePeaks(env.DB).catch(() => ({}));
  const [totalsRows, callCountries, sessionCountries, sessionsByDay, byTool, byClient, byDay, topProducts, missing, feedback] = await Promise.all([
    q("SELECT (SELECT COUNT(*) FROM calls WHERE ts >= ?1) AS calls, (SELECT COUNT(*) FROM sessions WHERE ts >= ?1) AS sessions, (SELECT COUNT(DISTINCT COALESCE(client_name, '(unknown)')) FROM sessions WHERE ts >= ?1) AS clients"),
    q("SELECT COALESCE(NULLIF(country, ''), '??') AS country, COUNT(*) AS calls FROM calls WHERE ts >= ? GROUP BY country ORDER BY calls DESC LIMIT 15"),
    q("SELECT COALESCE(NULLIF(country, ''), '??') AS country, COUNT(*) AS sessions FROM sessions WHERE ts >= ? GROUP BY country ORDER BY sessions DESC LIMIT 15"),
    q("SELECT substr(ts, 1, 10) AS day, COUNT(*) AS sessions FROM sessions WHERE ts >= ? GROUP BY day ORDER BY day"),
    q("SELECT tool, COUNT(*) AS calls FROM calls WHERE ts >= ? GROUP BY tool ORDER BY calls DESC"),
    q("SELECT COALESCE(client_name, '(unknown)') AS client, COUNT(*) AS sessions FROM sessions WHERE ts >= ? GROUP BY client ORDER BY sessions DESC LIMIT 20"),
    q("SELECT substr(ts, 1, 10) AS day, COUNT(*) AS calls FROM calls WHERE ts >= ? GROUP BY day ORDER BY day"),
    q(`WITH RECURSIVE split(p, rest) AS (
         SELECT '', products_requested || ',' FROM calls WHERE ts >= ? AND products_requested != ''
         UNION ALL SELECT lower(trim(substr(rest, 1, instr(rest, ',') - 1))), substr(rest, instr(rest, ',') + 1) FROM split WHERE rest != '')
       SELECT p AS product, COUNT(*) AS requests FROM split WHERE p != '' GROUP BY p ORDER BY requests DESC LIMIT 30`),
    q(`WITH RECURSIVE split(p, rest) AS (
         SELECT '', products_missing || ',' FROM calls WHERE ts >= ? AND products_missing != ''
         UNION ALL SELECT lower(trim(substr(rest, 1, instr(rest, ',') - 1))), substr(rest, instr(rest, ',') + 1) FROM split WHERE rest != '')
       SELECT p AS product, COUNT(*) AS requests FROM split WHERE p != '' GROUP BY p ORDER BY requests DESC LIMIT 30`),
    q("SELECT ts, product, plan, details, suggested_price FROM feedback WHERE ts >= ? ORDER BY ts DESC LIMIT 50"),
  ]);
  // failed requests (table is created lazily on the first failure)
  let failed: Record<string, unknown> = { note: "no failed requests logged yet" };
  let failedTotal = 0;
  try {
    const [byReason, byAgent, recent] = await Promise.all([
      q("SELECT status, message, COUNT(*) AS count FROM errors WHERE ts >= ? GROUP BY status, message ORDER BY count DESC LIMIT 20"),
      q("SELECT COALESCE(NULLIF(user_agent, ''), '(none)') AS user_agent, COUNT(*) AS count FROM errors WHERE ts >= ? GROUP BY user_agent ORDER BY count DESC LIMIT 20"),
      q("SELECT ts, method, status, message, rpc_method, protocol_version, user_agent, country FROM errors WHERE ts >= ? ORDER BY ts DESC LIMIT 25"),
    ]);
    failed = { by_reason: byReason, by_user_agent: byAgent, recent };
    failedTotal = (byReason as { count: number }[]).reduce((sum, r) => sum + Number(r.count), 0);
  } catch {
    /* errors table not created yet */
  }
  const totals = { ...(totalsRows[0] as Record<string, number>), failed: failedTotal };
  return Response.json({ days, generated_at: new Date().toISOString(), totals, cloudflare: await cloudflare, peaks: await peaks, calls_by_country: callCountries, sessions_by_country: sessionCountries, sessions_by_day: sessionsByDay, calls_by_tool: byTool, sessions_by_client: byClient, calls_by_day: byDay, most_requested_products: topProducts, requested_but_not_covered: missing, recent_feedback: feedback, failed_requests: failed }, { headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const response = await route(request, env, ctx, url);
    recordTraffic(request, url, response.status, env, ctx);
    return response;
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Uptime checkers and directory crawlers often send HEAD; answer it instead of logging a 405.
    if (request.method === "HEAD" && ["/", "/mcp", "/mcp/", "/health"].includes(url.pathname)) {
      return new Response(null, { status: 200, headers: { ...CORS, "Content-Type": url.pathname === "/" ? "text/html; charset=utf-8" : "application/json" } });
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return withCors(await handleMcp(request, env, ctx));
    if (url.pathname === "/stats/live") return live(request, env);
    if (url.pathname === "/stats") {
      // Browsers get the dashboard page; scripts (curl, the page itself via ?format=json) get the JSON.
      const wantsPage = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html") && url.searchParams.get("format") !== "json";
      return wantsPage ? dashboardResponse() : stats(request, env);
    }
    if (url.pathname === "/health") return Response.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION, dataset_version: dataset.dataset_version, products: products.length });
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(landingPage(url.origin, products, CATEGORIES, dataset.dataset_version, history.tracking_since), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  }
}
