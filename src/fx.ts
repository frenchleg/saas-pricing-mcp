import type { Rates } from "./types";

// Used only if the live rate can't be fetched. Update occasionally.
export const FALLBACK_RATES: Rates = { usd_to_gbp: 0.75, date: "2026-11-25", source: "fallback constant" };

const CACHE_KEY = "https://saas-pricing-mcp.internal/fx/usd-gbp";
const CACHE_SECONDS = 6 * 60 * 60;
let memo: { rates: Rates; at: number } | null = null;

/** Live USD->GBP rate (ECB reference rate via Frankfurter), cached for 6 hours. */
export async function getRates(): Promise<Rates> {
  if (memo && Date.now() - memo.at < CACHE_SECONDS * 1000) return memo.rates;

  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  if (cache) {
    const hit = await cache.match(CACHE_KEY).catch(() => undefined);
    if (hit) {
      const rates = (await hit.json()) as Rates;
      memo = { rates, at: Date.now() };
      return rates;
    }
  }

  const endpoints = [
    "https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP",
    "https://api.frankfurter.app/latest?from=USD&to=GBP",
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) continue;
      const body = (await res.json()) as { date?: string; rates?: { GBP?: number } };
      const gbp = body.rates?.GBP;
      if (typeof gbp === "number" && gbp > 0.4 && gbp < 1.5) {
        const rates: Rates = { usd_to_gbp: gbp, date: body.date ?? "", source: "ECB reference rate via frankfurter" };
        memo = { rates, at: Date.now() };
        if (cache) {
          await cache
            .put(CACHE_KEY, new Response(JSON.stringify(rates), { headers: { "Cache-Control": `max-age=${CACHE_SECONDS}` } }))
            .catch(() => undefined);
        }
        return rates;
      }
    } catch {
      // try next endpoint
    }
  }
  memo = { rates: FALLBACK_RATES, at: Date.now() - (CACHE_SECONDS - 300) * 1000 }; // retry in ~5 min
  return FALLBACK_RATES;
}
