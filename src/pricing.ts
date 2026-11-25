import type { Billing, Currency, Dataset, Plan, Product, Rates } from "./types";
import raw from "../data/products.json";

export const dataset = raw as unknown as Dataset;
export const products: Product[] = dataset.products;

// ---------- product lookup ----------

const ALIASES: Record<string, string> = {
  convertkit: "kit",
  "kit": "kit",
  "monday": "monday",
  "mondaycom": "monday",
  "hubspot": "hubspot-marketing",
  "hubspotmarketing": "hubspot-marketing",
  "gsuite": "google-workspace",
  "googleworkspace": "google-workspace",
  "gmailforbusiness": "google-workspace",
  "workspace": "google-workspace",
  "microsoft365": "microsoft-365-business",
  "m365": "microsoft-365-business",
  "office365": "microsoft-365-business",
  "o365": "microsoft-365-business",
  "microsoft365business": "microsoft-365-business",
  "copilot": "github-copilot",
  "githubcopilot": "github-copilot",
  "openai": "chatgpt",
  "chatgptplus": "chatgpt",
  "anthropic": "claude",
  "claudeai": "claude",
  "zoomworkplace": "zoom",
  "zoommeetings": "zoom",
  "jirasoftware": "jira",
  "jiracloud": "jira",
  "atlassianjira": "jira",
  "confluencecloud": "confluence",
  "1pass": "1password",
  "onepassword": "1password",
  "makecom": "make",
  "integromat": "make",
  "eleven": "elevenlabs",
  "elevenlabsio": "elevenlabs",
  "xerouk": "xero",
};

export const norm = (s: string) => s.toLowerCase().replace(/\.(com|io|app|so|ai|co)$/, "").replace(/[^a-z0-9]/g, "");

export function findProduct(query: string): Product | undefined {
  const q = norm(query);
  if (!q) return undefined;
  const byId = products.find((p) => norm(p.id) === q || norm(p.name) === q);
  if (byId) return byId;
  const alias = ALIASES[q];
  if (alias) return products.find((p) => p.id === alias);
  // prefix / contains match on the product name, e.g. "notion ai" -> notion
  return products.find((p) => q.startsWith(norm(p.id)) || norm(p.name).startsWith(q));
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function suggest(query: string, n = 3): string[] {
  const q = norm(query);
  return products
    .map((p) => ({ id: p.id, d: Math.min(levenshtein(q, norm(p.id)), levenshtein(q, norm(p.name))) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.id);
}

// ---------- prices & currency ----------

export interface Price {
  amount: number | null;
  currency: Currency;
  /** official = vendor-published in this currency; converted = FX conversion from the vendor's currency */
  basis: "official" | "converted" | "n/a";
  billing_used: Billing | null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

function nativeAmount(plan: Plan, billing: Billing): { amount: number | null; used: Billing | null } {
  const primary = billing === "annual" ? plan.annual_monthly : plan.monthly;
  if (primary != null) return { amount: primary, used: billing };
  const other = billing === "annual" ? plan.monthly : plan.annual_monthly;
  if (other != null) return { amount: other, used: billing === "annual" ? "monthly" : "annual" };
  return { amount: null, used: null };
}

/** Per-unit monthly price for a plan in the requested currency. */
export function planPrice(product: Product, plan: Plan, billing: Billing, currency: Currency, rates: Rates): Price {
  if (currency === "GBP" && product.currency === "USD") {
    const official = billing === "annual" ? plan.gbp_annual_monthly : plan.gbp_monthly;
    if (official != null) return { amount: official, currency, basis: "official", billing_used: billing };
  }
  const { amount, used } = nativeAmount(plan, billing);
  if (amount == null) return { amount: null, currency, basis: "n/a", billing_used: null };
  if (currency === product.currency || amount === 0) return { amount, currency, basis: "official", billing_used: used };
  const converted = product.currency === "USD" ? amount * rates.usd_to_gbp : amount / rates.usd_to_gbp;
  return { amount: round2(converted), currency, basis: "converted", billing_used: used };
}

export function resolveCurrency(requested: string | undefined, product?: Product): Currency {
  if (requested === "GBP" || requested === "USD") return requested;
  return product?.currency ?? "USD";
}

// ---------- cost estimates ----------

export interface Estimate {
  plan: string;
  unit: Plan["unit"];
  per_unit: Price;
  seats_billed: number | null;
  monthly_total: number | null;
  annual_total: number | null;
  caveat?: string;
}

export function estimate(product: Product, plan: Plan, seats: number, billing: Billing, currency: Currency, rates: Rates): Estimate {
  const per = planPrice(product, plan, billing, currency, rates);
  const base = { plan: plan.name, unit: plan.unit, per_unit: per };
  if (plan.unit === "custom" || per.amount == null) {
    return { ...base, seats_billed: null, monthly_total: null, annual_total: null, caveat: "Price not published; contact vendor." };
  }
  if (plan.max_seats && seats > plan.max_seats) {
    return { ...base, seats_billed: null, monthly_total: null, annual_total: null, caveat: `Plan allows at most ${plan.max_seats} seats.` };
  }
  let billed: number | null = null;
  let total = per.amount;
  let caveat: string | undefined;
  if (plan.unit === "per_user" || plan.unit === "per_channel") {
    billed = Math.max(seats, plan.min_seats ?? 1);
    total = per.amount * billed;
    if (plan.min_seats && seats < plan.min_seats) caveat = `Minimum ${plan.min_seats} seats billed.`;
    if (plan.unit === "per_channel") caveat = [caveat, "Priced per social channel; 'seats' treated as channels."].filter(Boolean).join(" ");
  } else if (plan.unit === "usage") {
    caveat = "Starting price; usage-based charges can increase the total.";
  } else if (plan.included_seats && seats > plan.included_seats) {
    caveat = `Includes ${plan.included_seats} seats; extra seats cost more.`;
  }
  if (per.billing_used && per.billing_used !== billing) {
    caveat = [caveat, `No ${billing} price published; ${per.billing_used} price used.`].filter(Boolean).join(" ");
  }
  return { ...base, seats_billed: billed, monthly_total: round2(total), annual_total: round2(total * 12), caveat };
}

export function isPaid(plan: Plan): boolean {
  const v = plan.monthly ?? plan.annual_monthly;
  return plan.unit !== "custom" && v != null && v > 0;
}

export function startingPrice(product: Product): { plan: string; monthly_from: number; currency: Currency } | null {
  const paid = product.plans.filter(isPaid);
  if (!paid.length) return null;
  const best = paid
    .map((p) => ({ plan: p.name, v: Math.min(...[p.monthly, p.annual_monthly].filter((x): x is number => x != null)) }))
    .sort((a, b) => a.v - b.v)[0];
  return { plan: best.plan, monthly_from: best.v, currency: product.currency };
}

// ---------- feature search ----------

const SYNONYMS: Record<string, string[]> = {
  sso: ["sso", "saml", "single sign-on", "single sign on", "oidc"],
  saml: ["saml"],
  "saml sso": ["saml"],
  scim: ["scim", "provisioning", "directory sync"],
  "audit log": ["audit log", "audit"],
  hipaa: ["hipaa", "baa"],
  api: ["api"],
  ai: ["ai", "copilot", "gemini", "agent"],
};

export function featureTerms(feature: string): string[] {
  const f = feature.toLowerCase().trim();
  return SYNONYMS[f] ?? [f];
}

export function planMatches(product: Product, plan: Plan, terms: string[]): string[] {
  const hay = [plan.name, plan.note ?? "", ...plan.features, ...plan.limits];
  return hay.filter((h) => terms.some((t) => h.toLowerCase().includes(t)));
}

/** Plans that include a feature directly or inherit it ("Everything in X") are only caught if listed; we also
 *  treat higher tiers of the same product as including the feature once a lower tier lists it. */
export function plansWithFeature(product: Product, terms: string[]): { plan: Plan; evidence: string[]; inherited: boolean }[] {
  const out: { plan: Plan; evidence: string[]; inherited: boolean }[] = [];
  let found = false;
  for (const plan of product.plans) {
    const ev = planMatches(product, plan, terms);
    if (ev.length) {
      found = true;
      out.push({ plan, evidence: ev, inherited: false });
    } else if (found && plan.unit !== "usage") {
      out.push({ plan, evidence: [], inherited: true });
    }
  }
  return out;
}

export const CATEGORIES = [...new Set(products.map((p) => p.category))].sort();
