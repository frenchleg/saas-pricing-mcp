// End-to-end check using the official MCP client against a running server.
// Usage: node test/smoke.mjs [endpoint]   (default http://127.0.0.1:8787/mcp)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";

const endpoint = process.argv[2] ?? "http://127.0.0.1:8787/mcp";
const client = new Client({ name: "smoke-test", version: "1.0.0" });
// The x-smoke-test header tells the server not to log this traffic, so tests don't skew /stats.
const TEST_HEADERS = { "x-smoke-test": "1" };
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: TEST_HEADERS } }));

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  return { isError: !!r.isError, body };
};
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log("  ✓", msg); };

const { tools } = await client.listTools();
ok(tools.length === 8, `lists 8 tools (${tools.map((t) => t.name).join(", ")})`);

let r = await call("list_products", {});
ok(r.body.count === 100, "list_products returns 100 products");
r = await call("list_products", { category: "ai" });
ok(r.body.products.every((p) => p.category === "ai") && r.body.count === 6, "category filter works (ai = 6)");

r = await call("get_pricing", { product: "Slack" });
const pro = r.body.plans.find((p) => p.name === "Pro");
ok(pro.price_billed_monthly === 8.75 && pro.price_per_month_billed_annually === 7.25, "Slack Pro USD 8.75 / 7.25");

r = await call("get_pricing", { product: "slack", currency: "GBP" });
const proG = r.body.plans.find((p) => p.name === "Pro");
ok(proG.price_basis === "converted" && r.body.meta.fx && proG.price_billed_monthly > 5 && proG.price_billed_monthly < 8, `Slack Pro GBP converted (£${proG.price_billed_monthly}, rate ${r.body.meta.fx.usd_to_gbp} from ${r.body.meta.fx.source})`);
ok(!!r.body.meta.vat_note, "GBP response carries VAT note");

r = await call("get_pricing", { product: "gsuite", currency: "GBP" });
const std = r.body.plans.find((p) => p.name === "Business Standard");
ok(r.body.product.id === "google-workspace" && std.price_basis === "official" && std.price_per_month_billed_annually === 11.8 && std.price_billed_monthly === 14, "alias 'gsuite' -> Google Workspace, official GBP £14 / £11.80");

r = await call("get_pricing", { product: "M365" });
ok(r.body.currency === "GBP" && r.body.plans[0].price_per_month_billed_annually === 5.4, "M365 native GBP £5.40");

r = await call("get_pricing", { product: "Xero", currency: "USD" });
ok(r.body.plans[0].price_basis === "converted" && r.body.plans[0].price_billed_monthly > 18, `Xero GBP->USD converted ($${r.body.plans[0].price_billed_monthly})`);

r = await call("get_pricing", { product: "Pipefy" });
ok(r.isError && Array.isArray(r.body.did_you_mean), `unknown product returns suggestions (${r.body.did_you_mean})`);

r = await call("compare_products", { products: ["Notion", "Confluence", "Pipefy"], seats: 10, billing: "monthly", paid_plans_only: true });
const notion = r.body.comparison.find((c) => c.product_id === "notion");
ok(notion.cheapest_paid_plan === "Plus" && notion.cheapest_paid_monthly_total === 100, "Notion 10 seats: Plus = $100/month");
ok(r.body.not_covered?.includes("Pipefy"), "compare reports uncovered products");

r = await call("compare_products", { products: ["monday"], seats: 1, billing: "annual" });
const basic = r.body.comparison[0].plans.find((p) => p.plan === "Basic");
ok(basic.seats_billed === 3 && basic.monthly_total === 27 && /Minimum 3/.test(basic.caveat), "monday Basic applies 3-seat minimum ($27)");

r = await call("compare_products", { products: ["linear"], seats: 5, billing: "monthly" });
const lb = r.body.comparison[0].plans.find((p) => p.plan === "Basic");
ok(lb.per_unit.billing_used === "annual" && /No monthly price/.test(lb.caveat), "falls back to annual price with caveat when monthly missing");

r = await call("search_plans", { feature: "saml", category: "project-management" });
ok(r.body.products_matched === 3 && r.body.cheapest_plan_per_product.every((x) => x.product_id), `search SAML in PM finds ${r.body.products_matched} products`);

r = await call("search_plans", { feature: "saml", limit: 50 });
ok(r.body.cheapest_plan_per_product.every((x) => x.match === "assumed from lower tier ('everything in…')" || x.match.some((m) => /saml/i.test(m))), "'saml' search never matches Google-only SSO");
ok(!r.body.cheapest_plan_per_product.some((x) => x.product_id === "linear" && x.plan === "Free"), "Linear Free (Google SSO) excluded from SAML results");

r = await call("search_plans", { feature: "sso", max_price: 10, currency: "GBP", billing: "annual" });
ok(r.body.cheapest_plan_per_product.every((x) => x.price_per_month <= 10), "search with GBP budget respects max_price");

r = await call("search_plans", {});
ok(r.isError, "search with no criteria is an error");

r = await call("report_outdated", { product: "Pipefy", details: "Please add Pipefy" });
ok(r.body.received && r.body.covered === false, "report_outdated accepts uncovered product");

// ---- v0.2: new products ----
r = await call("get_pricing", { product: "Salesforce", currency: "GBP" });
const sfs = r.body.plans.find((p) => p.name === "Starter Suite");
ok(sfs.price_basis === "official" && sfs.price_billed_monthly === 20, "Salesforce uses official GBP (£20 Starter Suite)");
r = await call("get_pricing", { product: "Adobe Creative Cloud" });
ok(r.body.product.prices_include_vat === true, "Adobe UK flagged as VAT-inclusive");
r = await call("compare_products", { products: ["FreeAgent", "Xero", "QuickBooks UK", "Sage"], seats: 1, currency: "GBP", paid_plans_only: true });
ok(r.body.comparison.length === 4 && r.body.comparison.every((c) => c.cheapest_paid_monthly_total > 0), "UK accounting comparison covers all 4 in GBP");
ok(r.body.comparison.every((c) => Array.isArray(c.compliance)), "compare includes compliance summaries");

// ---- compliance ----
r = await call("get_compliance", { product: "basecamp" });
ok(r.body.compliance.hipaa === "no" && r.body.compliance.soc2 === "no" && r.body.compliance.eu_data_residency === "no", "Basecamp: vendor-stated negatives recorded (no SOC 2 audit, no HIPAA, no EU hosting)");
r = await call("get_compliance", { product: "resend" });
ok(r.body.compliance.soc2 === "type2" && r.body.compliance.iso27001 === "no", "Resend: SOC 2 Type II yes, ISO 27001 explicitly no");
r = await call("get_compliance", { product: "notion" });
ok(r.body.compliance.ai_training === "no_training" && r.body.compliance.evidence.soc2?.startsWith("https://"), "Notion: no AI training + evidence URL");
r = await call("find_compliant_tools", { requirements: ["soc2_type2", "eu_data_residency"], category: "project-management" });
const ids = r.body.meets_all.map((m) => m.product_id);
ok(["linear", "asana", "monday"].every((x) => ids.includes(x)) && !ids.includes("basecamp"), `SOC 2 Type II + EU residency in PM: ${ids.join(", ")}`);
ok(r.body.meets_all.every((m) => m.evidence.soc2_type2 && m.evidence.eu_data_residency), "every match carries evidence for each requirement");
r = await call("find_compliant_tools", { requirements: ["hipaa"] });
const all = [...r.body.meets_all, ...r.body.possible_matches_unknown_fields].map((m) => m.product_id);
ok(!all.includes("basecamp") && !all.includes("resend") && r.body.meets_all.length >= 30, `HIPAA: ${r.body.meets_all.length} tools, explicit 'no' vendors excluded`);
r = await call("find_compliant_tools", { requirements: ["cyber_essentials"], max_price: 30, currency: "GBP" });
ok(r.body.meets_all.every((m) => m.cheapest_paid_plan.price_per_month <= 30), `Cyber Essentials under £30: ${r.body.meets_all.map((m) => m.product_id).join(", ")}`);

r = await call("price_history", {});
ok(!r.isError && /^\d{4}-\d{2}-\d{2}$/.test(r.body.tracking_since) && Array.isArray(r.body.changes), `price_history works (tracking since ${r.body.tracking_since}, ${r.body.count} changes)`);
r = await call("price_history", { product: "notion", since: "2026-01-01" });
ok(!r.isError && r.body.changes.every((c) => c.product === "notion"), "price_history filters by product");
r = await call("price_history", { product: "nonexistent-tool-xyz" });
ok(r.isError, "price_history rejects unknown product");
r = await call("get_pricing", { product: "slack" });
ok("recent_changes" in r.body, "get_pricing includes recent_changes");

// ---- robustness: clients newer than our SDK, or with a partial Accept header, still get served ----
{
  const raw = async (headers, body) => {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...TEST_HEADERS, ...headers }, body });
    return { status: res.status, body: await res.text() };
  };
  const list = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" });
  let x = await raw({ Accept: "application/json, text/event-stream", "mcp-protocol-version": "2099-01-01" }, list);
  ok(x.status === 200 && x.body.includes("get_compliance"), "unknown future protocol version is served, not rejected");
  x = await raw({ Accept: "application/json" }, list);
  ok(x.status === 200, "Accept: application/json alone is served");
  x = await raw({}, list);
  ok(x.status === 200, "missing Accept header is served");
  x = await raw({ Accept: "application/json, text/event-stream" }, "{bad");
  ok(x.status === 400, "malformed JSON still gets a 400 parse error");
  const head = await fetch(endpoint, { method: "HEAD", headers: TEST_HEADERS });
  ok(head.status === 200, "HEAD health check gets 200");
}

await client.close();
console.log(`\n${passed} checks passed`);
