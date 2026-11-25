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

async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

async function stats(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const key = new URL(request.url).searchParams.get("key");
  if (!env.STATS_KEY || (auth !== `Bearer ${env.STATS_KEY}` && key !== env.STATS_KEY)) return new Response("Unauthorized", { status: 401 });
  if (!env.DB) return Response.json({ error: "No D1 database bound" }, { status: 500 });
  const days = Math.min(Number(new URL(request.url).searchParams.get("days") ?? 7) || 7, 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const q = async (sql: string) => (await env.DB!.prepare(sql).bind(since).all()).results;
  const [byTool, byClient, byDay, topProducts, missing, feedback] = await Promise.all([
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
  try {
    const [byReason, byAgent, recent] = await Promise.all([
      q("SELECT status, message, COUNT(*) AS count FROM errors WHERE ts >= ? GROUP BY status, message ORDER BY count DESC LIMIT 20"),
      q("SELECT COALESCE(NULLIF(user_agent, ''), '(none)') AS user_agent, COUNT(*) AS count FROM errors WHERE ts >= ? GROUP BY user_agent ORDER BY count DESC LIMIT 20"),
      q("SELECT ts, method, status, message, rpc_method, protocol_version, user_agent, country FROM errors WHERE ts >= ? ORDER BY ts DESC LIMIT 25"),
    ]);
    failed = { by_reason: byReason, by_user_agent: byAgent, recent };
  } catch {
    /* errors table not created yet */
  }
  return Response.json({ days, calls_by_tool: byTool, sessions_by_client: byClient, calls_by_day: byDay, most_requested_products: topProducts, requested_but_not_covered: missing, recent_feedback: feedback, failed_requests: failed });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return withCors(await handleMcp(request, env, ctx));
    if (url.pathname === "/stats") return stats(request, env);
    if (url.pathname === "/health") return Response.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION, dataset_version: dataset.dataset_version, products: products.length });
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(landingPage(url.origin, products, CATEGORIES, dataset.dataset_version), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
