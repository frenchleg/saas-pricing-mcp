// Cloudflare's own metrics for this Worker (all requests, errors, CPU time, data centres),
// fetched server-side from the GraphQL Analytics API so the API token never reaches a browser.
// Needs two secrets: CF_API_TOKEN (Account Analytics: Read) and CF_ACCOUNT_ID.
import type { Env } from "./types";

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const SCRIPT_NAME = "saas-pricing-mcp";
const MAX_DAYS = 30; // Cloudflare allows at most one month per query.
const CACHE_MS = 5 * 60_000;

type Row = { count?: number; sum?: { requests?: number; errors?: number; subrequests?: number }; quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number }; dimensions?: Record<string, string> };
let cache: { key: string; at: number; value: unknown } | null = null;

async function gql(env: Env, query: string, variables: Record<string, unknown>): Promise<Row[]> {
  const res = await fetch(env.CF_GRAPHQL_URL || GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Cloudflare rejected the API token. It needs Account Analytics: Read.");
  if (!res.ok) throw new Error(`Cloudflare analytics answered ${res.status}`);
  const body = (await res.json()) as { data?: { viewer?: { accounts?: { rows?: Row[] }[] } }; errors?: { message: string }[] | null };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; ").slice(0, 300));
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("No Cloudflare account matched CF_ACCOUNT_ID, or the token can't see it.");
  return account.rows ?? [];
}

const query = (dims: string) => `query ($accountTag: string, $start: string, $end: string, $script: string) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    rows: workersInvocationsAdaptive(limit: 10000, filter: { scriptName: $script, datetime_geq: $start, datetime_leq: $end }) {
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP99 }
      dimensions { ${dims} }
    }
  } }
}`;

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
const ms = (us: number | undefined) => (us == null ? null : Math.round(us / 10) / 100); // CPU time comes in microseconds

// HTTP-level breakdowns (country, status code, path), the same data as Cloudflare's Traffic overview.
const httpQuery = (dim: string, limit: number) => `query ($accountTag: string, $start: string, $end: string, $host: string) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    rows: httpRequestsAdaptiveGroups(limit: ${limit}, filter: { clientRequestHTTPHost: $host, datetime_geq: $start, datetime_leq: $end }, orderBy: [count_DESC]) {
      count
      dimensions { ${dim} }
    }
  } }
}`;

export async function cloudflareMetrics(env: Env, days: number, host = ""): Promise<Record<string, unknown>> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { configured: false };
  const span = Math.min(Math.max(1, days), MAX_DAYS);
  const cacheKey = `${span}|${host}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_MS) return { ...(cache.value as Record<string, unknown>), capped: days > MAX_DAYS };

  const end = new Date();
  const start = new Date(end.getTime() - span * 86400_000);
  const vars = { accountTag: env.CF_ACCOUNT_ID, start: start.toISOString(), end: end.toISOString(), script: SCRIPT_NAME };
  try {
    // Totals and CPU time by outcome (one row per status).
    const byStatus = await gql(env, query("status"), vars);
    // Daily totals: prefer the date dimension; fall back to hourly buckets if this dataset lacks it.
    let daily: Row[] = [];
    let dayKey = "date";
    for (const dim of ["date", "datetimeHour"]) {
      try { daily = await gql(env, query(dim), vars); dayKey = dim; break; } catch (e) { if (dim === "datetimeHour") throw e; }
    }
    // Which Cloudflare data centres answered (optional; ignored if unavailable).
    let colos: Row[] = [];
    try { colos = await gql(env, query("coloCode"), vars); } catch { /* not critical */ }
    // Best effort: these need the HTTP requests dataset, which some accounts/tokens can't read.
    const http = async (dim: string, limit: number) => {
      if (!host) return [];
      try {
        const rows = await gql(env, httpQuery(dim, limit), { accountTag: env.CF_ACCOUNT_ID, start: vars.start, end: vars.end, host });
        return rows.map((r) => ({ key: String(r.dimensions?.[dim] ?? "?"), requests: n(r.count) }));
      } catch { return null; }
    };
    const [countries, statusCodes, paths, ips, devices] = await Promise.all([
      http("clientCountryName", 60), http("edgeResponseStatus", 30), http("clientRequestPath", 10), http("clientIP", 10), http("clientDeviceType", 5),
    ]);

    const dayMap = new Map<string, { requests: number; errors: number }>();
    for (const r of daily) {
      const day = String(r.dimensions?.[dayKey] ?? "").slice(0, 10);
      if (!day) continue;
      const cur = dayMap.get(day) ?? { requests: 0, errors: 0 };
      cur.requests += n(r.sum?.requests); cur.errors += n(r.sum?.errors);
      dayMap.set(day, cur);
    }
    const requests = byStatus.reduce((s, r) => s + n(r.sum?.requests), 0);
    const errors = byStatus.reduce((s, r) => s + n(r.sum?.errors), 0);
    const subrequests = byStatus.reduce((s, r) => s + n(r.sum?.subrequests), 0);
    // Overall CPU percentiles: the "success" row when present (most traffic), else the busiest row.
    const main = byStatus.find((r) => r.dimensions?.status === "success") ?? [...byStatus].sort((a, b) => n(b.sum?.requests) - n(a.sum?.requests))[0];
    const value = {
      configured: true,
      days: span,
      capped: days > MAX_DAYS,
      requests,
      errors,
      subrequests,
      error_rate: requests ? Math.round((errors / requests) * 10000) / 100 : 0,
      cpu_ms_p50: ms(main?.quantiles?.cpuTimeP50),
      cpu_ms_p99: ms(main?.quantiles?.cpuTimeP99),
      by_day: [...dayMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, v]) => ({ day, ...v })),
      by_status: byStatus.map((r) => ({ status: r.dimensions?.status ?? "unknown", requests: n(r.sum?.requests) })).sort((a, b) => b.requests - a.requests),
      by_country: countries ? countries.map((c) => ({ country: c.key, requests: c.requests })) : null,
      status_codes: statusCodes ? statusCodes.map((c) => ({ code: Number(c.key) || c.key, requests: c.requests })) : null,
      top_paths: paths ? paths.map((c) => ({ path: c.key, requests: c.requests })) : null,
      // Read from Cloudflare's analytics at view time; this server never stores IP addresses.
      top_ips: ips ? ips.map((c) => ({ ip: c.key, requests: c.requests })) : null,
      device_types: devices ? devices.map((c) => ({ device: c.key, requests: c.requests })) : null,
      by_colo: colos.map((r) => ({ colo: r.dimensions?.coloCode ?? "?", requests: n(r.sum?.requests) })).sort((a, b) => b.requests - a.requests).slice(0, 10),
    };
    cache = { key: cacheKey, at: Date.now(), value };
    return value;
  } catch (e) {
    return { configured: true, error: e instanceof Error ? e.message : String(e) };
  }
}
