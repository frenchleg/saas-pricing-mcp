import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { getRates } from "./fx";
import {
  CATEGORIES,
  dataset,
  estimate,
  featureTerms,
  findProduct,
  isPaid,
  planPrice,
  plansWithFeature,
  products,
  resolveCurrency,
  startingPrice,
  suggest,
  REQUIREMENTS,
  REQUIREMENT_KEYS,
  checkRequirements,
  complianceSummary,
  type Requirement,
} from "./pricing";
import type { Billing, Currency, Product } from "./types";

export const SERVER_NAME = "saas-pricing";
export const SERVER_VERSION = "0.2.0";

export interface CallLog {
  tool: string;
  products_requested: string[];
  products_missing: string[];
  args: Record<string, unknown>;
  ok: boolean;
}

export type Logger = (entry: CallLog) => void;

const currencyArg = z
  .enum(["USD", "GBP"])
  .optional()
  .describe("Currency for prices. Defaults to the vendor's own currency. GBP uses official UK prices where published, otherwise converts at the live ECB rate.");
const billingArg = z.enum(["monthly", "annual"]).optional().describe("Billing period. 'annual' gives the per-month equivalent when billed yearly. Default monthly.");

function meta(currency: Currency, rates: { usd_to_gbp: number; date: string; source: string }, usedConversion: boolean) {
  return {
    dataset_version: dataset.dataset_version,
    prices_exclude_tax: "true unless a product says prices_include_vat",
    ...(currency === "GBP" ? { vat_note: "UK prices are normally quoted excluding 20% VAT." } : {}),
    ...(usedConversion
      ? { fx: { usd_to_gbp: rates.usd_to_gbp, date: rates.date, source: rates.source, note: "Converted prices are estimates; vendors' local list prices often differ from a straight conversion." } }
      : {}),
    report_errors: "If a price looks wrong or out of date, call report_outdated.",
  };
}

const json = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 1) }] });
const fail = (msg: string, extra: Record<string, unknown> = {}) => ({
  isError: true,
  content: [{ type: "text" as const, text: JSON.stringify({ error: msg, ...extra }, null, 1) }],
});

function productHeader(p: Product) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    vendor_currency: p.currency,
    pricing_url: p.pricing_url,
    last_checked: p.checked,
    data_source: p.source === "secondary" ? "secondary (vendor page unreadable; dated third-party reports)" : "vendor pricing page",
    free_tier: p.free_tier,
    free_trial: p.free_trial,
    ...(p.prices_include_vat ? { prices_include_vat: true } : {}),
    notes: p.notes,
  };
}

export function buildServer(log: Logger, recordFeedback: (f: { product: string; plan?: string; details: string; suggested_price?: string }) => Promise<void>) {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        "Current list prices, plans, limits and features for 100 popular SaaS tools (USD and GBP), plus vendor-stated compliance facts " +
        "(SOC 2, ISO 27001, Cyber Essentials, HIPAA, UK/EU data residency, AI training on customer data). " +
        "Use this before stating what a SaaS product costs, which plan includes a feature like SSO, comparing tools for a team size, " +
        "or checking whether a tool meets security/procurement requirements. Every fact carries a date and source; " +
        "say 'not found' rather than 'no' for unknown compliance fields, and flag converted prices as estimates.",
    },
  );

  server.registerTool(
    "list_products",
    {
      title: "List covered SaaS products",
      description: `List the SaaS products this server has pricing for, with starting paid price. Categories: ${CATEGORIES.join(", ")}.`,
      inputSchema: { category: z.string().optional().describe("Filter by category, e.g. 'project-management', 'ai', 'hosting'.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ category }) => {
      const list = products
        .filter((p) => !category || p.category === category.toLowerCase())
        .map((p) => ({ id: p.id, name: p.name, category: p.category, free_tier: p.free_tier, starting_price: startingPrice(p), last_checked: p.checked }));
      log({ tool: "list_products", products_requested: [], products_missing: [], args: { category }, ok: true });
      if (!list.length) return fail(`No products in category '${category}'.`, { categories: CATEGORIES });
      return json({ count: list.length, products: list, dataset_version: dataset.dataset_version });
    },
  );

  server.registerTool(
    "get_pricing",
    {
      title: "Get a product's plans and prices",
      description:
        "Full current pricing for one SaaS product: every plan with monthly and annual prices, pricing unit (per user, flat, usage), limits, key features, free tier/trial, source URL and last-checked date.",
      inputSchema: {
        product: z.string().describe("Product name or id, e.g. 'Notion', 'slack', 'Google Workspace', 'M365'."),
        currency: currencyArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ product, currency }) => {
      const p = findProduct(product);
      log({ tool: "get_pricing", products_requested: [product], products_missing: p ? [] : [product], args: { product, currency }, ok: !!p });
      if (!p) return fail(`No pricing data for '${product}'.`, { did_you_mean: suggest(product), tip: "Call list_products to see coverage. Missing products are logged and prioritised for adding." });
      const cur = resolveCurrency(currency, p);
      const rates = await getRates();
      let converted = false;
      const plans = p.plans.map((pl) => {
        const m = planPrice(p, pl, "monthly", cur, rates);
        const a = planPrice(p, pl, "annual", cur, rates);
        if (m.basis === "converted" || a.basis === "converted") converted = true;
        return {
          name: pl.name,
          unit: pl.unit,
          price_billed_monthly: pl.monthly != null || pl.gbp_monthly != null ? m.amount : null,
          price_per_month_billed_annually: pl.annual_monthly != null || pl.gbp_annual_monthly != null ? a.amount : null,
          price_basis: m.basis !== "n/a" ? m.basis : a.basis,
          ...(pl.min_seats ? { min_seats: pl.min_seats } : {}),
          ...(pl.included_seats ? { included_seats: pl.included_seats } : {}),
          ...(pl.note ? { note: pl.note } : {}),
          limits: pl.limits,
          features: pl.features,
        };
      });
      return json({ product: productHeader(p), currency: cur, plans, meta: meta(cur, rates, converted) });
    },
  );

  server.registerTool(
    "search_plans",
    {
      title: "Find plans with a feature or under a budget",
      description:
        "Search across all products for plans that include a feature (e.g. 'SSO', 'SCIM', 'audit log', 'HIPAA', 'API') and/or cost at most max_price per unit per month. Results sorted by price, cheapest first.",
      inputSchema: {
        feature: z.string().optional().describe("Feature keyword. 'sso' matches any single sign-on incl. Google SSO; use 'saml' for enterprise SAML SSO only. Also: 'scim', 'audit log', 'hipaa', 'api'."),
        category: z.string().optional().describe("Limit to a category, e.g. 'project-management'."),
        max_price: z.number().nonnegative().optional().describe("Maximum price per unit (user/seat or flat) per month, in the chosen currency."),
        currency: currencyArg,
        billing: billingArg,
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 15)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ feature, category, max_price, currency, billing, limit }) => {
      log({ tool: "search_plans", products_requested: [], products_missing: [], args: { feature, category, max_price, currency, billing }, ok: true });
      if (!feature && max_price == null) return fail("Provide at least one of 'feature' or 'max_price'.");
      const cur: Currency = currency ?? "USD";
      const bill: Billing = billing ?? "monthly";
      const rates = await getRates();
      const terms = feature ? featureTerms(feature) : [];
      let converted = false;
      const rows: Record<string, unknown>[] = [];
      for (const p of products) {
        if (category && p.category !== category.toLowerCase()) continue;
        const candidates = feature ? plansWithFeature(p, terms) : p.plans.map((plan) => ({ plan, evidence: [] as string[], inherited: false }));
        for (const c of candidates) {
          const price = planPrice(p, c.plan, bill, cur, rates);
          if (max_price != null && (price.amount == null || price.amount > max_price)) continue;
          if (price.basis === "converted") converted = true;
          rows.push({
            product: p.name,
            product_id: p.id,
            plan: c.plan.name,
            unit: c.plan.unit,
            price_per_month: price.amount,
            price_basis: price.basis,
            billing_used: price.billing_used,
            ...(feature ? { match: c.inherited ? "assumed from lower tier ('everything in…')" : c.evidence.slice(0, 2) } : {}),
            last_checked: p.checked,
          });
        }
      }
      // cheapest matching plan per product; unpublished (custom) prices sort last
      rows.sort((a, b) => ((a.price_per_month as number | null) ?? Infinity) - ((b.price_per_month as number | null) ?? Infinity));
      const seen = new Set<string>();
      const cheapestPerProduct = rows.filter((r) => {
        const id = r.product_id as string;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return json({
        query: { feature, category, max_price, currency: cur, billing: bill },
        products_matched: cheapestPerProduct.length,
        cheapest_plan_per_product: cheapestPerProduct.slice(0, limit ?? 15),
        note: "Shows the cheapest matching plan for each product. Use get_pricing for a product's full plan list. Feature matching is keyword-based on each plan's listed features.",
        meta: meta(cur, rates, converted),
      });
    },
  );

  server.registerTool(
    "compare_products",
    {
      title: "Compare costs for a team",
      description:
        "Compare 2-8 SaaS products for a given team size: per-plan monthly and annual totals, applying per-seat pricing and seat minimums, plus the cheapest paid plan for each.",
      inputSchema: {
        products: z.array(z.string()).min(1).max(8).describe("Product names or ids, e.g. ['Notion','Confluence']."),
        seats: z.number().int().min(1).max(100000).optional().describe("Number of users/seats (default 1)."),
        billing: billingArg,
        currency: currencyArg,
        paid_plans_only: z.boolean().optional().describe("Exclude free plans (default false)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ products: names, seats, billing, currency, paid_plans_only }) => {
      const found = names.map((n) => ({ n, p: findProduct(n) }));
      const missing = found.filter((f) => !f.p).map((f) => f.n);
      log({ tool: "compare_products", products_requested: names, products_missing: missing, args: { products: names, seats, billing, currency }, ok: missing.length < names.length });
      const s = seats ?? 1;
      const bill: Billing = billing ?? "monthly";
      const cur: Currency = currency ?? (found.find((f) => f.p)?.p?.currency ?? "USD");
      const rates = await getRates();
      let converted = false;
      const results = found
        .filter((f) => f.p)
        .map(({ p }) => {
          const prod = p as Product;
          const ests = prod.plans
            .filter((pl) => !paid_plans_only || isPaid(pl) || pl.unit === "custom")
            .map((pl) => estimate(prod, pl, s, bill, cur, rates));
          if (ests.some((e) => e.per_unit.basis === "converted")) converted = true;
          const cheapestPaid = ests
            .filter((e) => e.monthly_total != null && e.monthly_total > 0)
            .sort((a, b) => (a.monthly_total as number) - (b.monthly_total as number))[0];
          return { product: prod.name, product_id: prod.id, last_checked: prod.checked, data_source: prod.source, compliance: complianceSummary(prod), cheapest_paid_plan: cheapestPaid?.plan ?? null, cheapest_paid_monthly_total: cheapestPaid?.monthly_total ?? null, plans: ests };
        });
      if (!results.length) return fail("None of those products are covered.", { missing, did_you_mean: missing.flatMap((m) => suggest(m, 2)) });
      return json({
        seats: s,
        billing: bill,
        currency: cur,
        comparison: results,
        ...(missing.length ? { not_covered: missing, did_you_mean: Object.fromEntries(missing.map((m) => [m, suggest(m, 2)])) } : {}),
        note: "Totals are list-price estimates before tax, discounts, add-ons and usage overages. Cheapest paid plan is by price only; check features.",
        meta: meta(cur, rates, converted),
      });
    },
  );


  const reqEnum = z.enum(REQUIREMENT_KEYS as [Requirement, ...Requirement[]]);
  const complianceMeta = {
    meaning:
      "'yes' = stated on the vendor's own public pages (see evidence URLs). null = not found on the pages checked; it may still be true, so check the vendor's trust centre. 'no' = vendor explicitly states it does not.",
    not_legal_advice: "Confirm certifications and contract terms (DPA, BAA) with the vendor before relying on them.",
  };

  server.registerTool(
    "get_compliance",
    {
      title: "Get a product's security & compliance facts",
      description:
        "Vendor-stated security and compliance facts for one SaaS product: SOC 2 (Type II), ISO 27001, ISO 42001, UK Cyber Essentials, PCI DSS, GDPR, HIPAA/BAA, EU and UK data residency, whether it trains AI on customer data, plus links to its trust centre, sub-processor list and DPA. Each fact has an evidence URL.",
      inputSchema: { product: z.string().describe("Product name or id, e.g. 'Slack', 'xero'.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ product }) => {
      const p = findProduct(product);
      log({ tool: "get_compliance", products_requested: [product], products_missing: p ? [] : [product], args: { product }, ok: !!p });
      if (!p) return fail(`No data for '${product}'.`, { did_you_mean: suggest(product) });
      const c = p.compliance;
      if (!c) return fail(`No compliance data yet for ${p.name}.`);
      const { needs_review: _nr, ...rest } = c;
      return json({ product: p.name, product_id: p.id, summary: complianceSummary(p), compliance: rest, meta: complianceMeta });
    },
  );

  server.registerTool(
    "find_compliant_tools",
    {
      title: "Find tools meeting security requirements (with prices)",
      description:
        "Find SaaS products that meet ALL the given compliance requirements (e.g. soc2_type2 + eu_data_residency + no_ai_training), optionally within a category and under a per-unit price, sorted by cheapest paid plan. Also lists near-misses where a requirement is unknown rather than failed. Requirements: " +
        REQUIREMENT_KEYS.map((k) => `${k} (${REQUIREMENTS[k].label})`).join("; ") + ".",
      inputSchema: {
        requirements: z.array(reqEnum).min(1).max(8),
        category: z.string().optional().describe("e.g. 'project-management', 'crm', 'hr', 'accounting'."),
        max_price: z.number().nonnegative().optional().describe("Max price per unit per month for the cheapest paid plan, in the chosen currency."),
        currency: currencyArg,
        billing: billingArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ requirements, category, max_price, currency, billing }) => {
      log({ tool: "find_compliant_tools", products_requested: [], products_missing: [], args: { requirements, category, max_price, currency, billing }, ok: true });
      const cur: Currency = currency ?? "USD";
      const bill: Billing = billing ?? "monthly";
      const rates = await getRates();
      let converted = false;
      const matches: Record<string, unknown>[] = [];
      const unknownOnly: Record<string, unknown>[] = [];
      for (const p of products) {
        if (category && p.category !== category.toLowerCase()) continue;
        const r = checkRequirements(p, requirements);
        if (r.failed.length) continue;
        const paid = p.plans
          .filter((pl) => isPaid(pl))
          .map((pl) => ({ pl, price: planPrice(p, pl, bill, cur, rates) }))
          .filter((x) => x.price.amount != null)
          .sort((a, b) => (a.price.amount as number) - (b.price.amount as number))[0];
        if (max_price != null && (!paid || (paid.price.amount as number) > max_price)) continue;
        if (paid?.price.basis === "converted") converted = true;
        const row = {
          product: p.name,
          product_id: p.id,
          category: p.category,
          cheapest_paid_plan: paid ? { plan: paid.pl.name, unit: paid.pl.unit, price_per_month: paid.price.amount, price_basis: paid.price.basis, billing_used: paid.price.billing_used } : null,
          free_tier: p.free_tier,
          compliance: complianceSummary(p),
          evidence: Object.fromEntries(requirements.map((q) => [q, p.compliance?.evidence[q === "soc2_type2" ? "soc2" : q === "no_ai_training" ? "ai_training" : q] ?? null])),
        };
        if (r.unknown.length === 0) matches.push(row);
        else if (r.met.length) unknownOnly.push({ ...row, unknown: r.unknown });
      }
      const byPrice = (a: Record<string, unknown>, b: Record<string, unknown>) =>
        (((a.cheapest_paid_plan as { price_per_month: number } | null)?.price_per_month) ?? Infinity) -
        (((b.cheapest_paid_plan as { price_per_month: number } | null)?.price_per_month) ?? Infinity);
      matches.sort(byPrice);
      unknownOnly.sort((a, b) => (a.unknown as string[]).length - (b.unknown as string[]).length || byPrice(a, b));
      return json({
        requirements: requirements.map((r) => ({ key: r, label: REQUIREMENTS[r].label })),
        filters: { category, max_price, currency: cur, billing: bill },
        meets_all: matches,
        possible_matches_unknown_fields: unknownOnly.slice(0, 10),
        note: "Cheapest paid plan is by price only; the compliance feature may need a higher tier (e.g. HIPAA/BAA or data residency are often Enterprise-only). Check get_pricing and the vendor.",
        compliance_meta: complianceMeta,
        meta: meta(cur, rates, converted),
      });
    },
  );

  server.registerTool(
    "report_outdated",
    {
      title: "Report wrong or outdated pricing",
      description: "Flag a price, plan, feature or compliance fact in this dataset that looks wrong or out of date, or request a product that isn't covered. Reports are reviewed by the maintainer.",
      inputSchema: {
        product: z.string().describe("Product name or id (can be a product not yet covered)."),
        plan: z.string().optional(),
        details: z.string().max(1000).describe("What is wrong, e.g. 'Pro is now $12/user/month billed monthly per vendor page'."),
        suggested_price: z.string().max(200).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ product, plan, details, suggested_price }) => {
      const p = findProduct(product);
      log({ tool: "report_outdated", products_requested: [product], products_missing: p ? [] : [product], args: { product, plan }, ok: true });
      await recordFeedback({ product: p?.id ?? product, plan, details, suggested_price });
      return json({ received: true, product: p?.id ?? product, covered: !!p, thanks: "Logged for review." });
    },
  );

  return server;
}
