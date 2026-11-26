// Writes a markdown summary of a month's SaaS price changes, as a draft for a
// newsletter, blog post or short video script.
//
//   node scripts/monthly-report.mjs              # last month
//   node scripts/monthly-report.mjs 2026-12      # a given month
//   node scripts/monthly-report.mjs 2026-12 out.md
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const history = JSON.parse(await readFile(new URL("data/price-history.json", root), "utf8"));
const d = new Date();
const lastMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const month = process.argv[2] ?? lastMonth;
if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must be YYYY-MM");
const out = process.argv[3] ?? `reports/${month}.md`;

const sym = { USD: "$", GBP: "£", EUR: "€" };
const money = (c, v) => (typeof v === "number" ? `${sym[c] ?? ""}${v.toFixed(2).replace(/\.00$/, "")}` : "n/a");
const label = (f) => (f === "annual_monthly" ? "billed annually" : "billed monthly");

const all = history.changes.filter((c) => c.date.startsWith(month) && c.kind === "change");
const prices = all.filter((c) => c.type === "price_change" && c.old != null && c.new != null);
const rises = prices.filter((c) => c.new > c.old).sort((a, b) => b.pct_change - a.pct_change);
const cuts = prices.filter((c) => c.new < c.old).sort((a, b) => a.pct_change - b.pct_change);
const plans = all.filter((c) => c.type !== "price_change");
const other = all.filter((c) => c.type === "price_change" && (c.old == null || c.new == null));

const line = (c) => `- **${c.product_name} ${c.plan}** (${label(c.field)}): ${money(c.currency, c.old)} → ${money(c.currency, c.new)} (${c.pct_change > 0 ? "+" : ""}${c.pct_change}%)${c.note ? `. ${c.note}` : ""}`;
const planLine = (c) => {
  const what = { plan_added: "new plan", plan_removed: "plan removed", product_added: "now tracked", product_removed: "no longer tracked" }[c.type];
  return `- **${c.product_name}${c.plan ? ` ${c.plan}` : ""}**: ${what}`;
};

const products = new Set(all.map((c) => c.product));
const avgRise = rises.length ? Math.round((rises.reduce((s, c) => s + c.pct_change, 0) / rises.length) * 10) / 10 : null;
const md = [
  `# SaaS price changes: ${new Date(month + "-01").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`,
  "",
  all.length
    ? `${products.size} product${products.size === 1 ? "" : "s"} changed pricing. ${rises.length} price rise${rises.length === 1 ? "" : "s"}${avgRise != null ? ` (average +${avgRise}%)` : ""}, ${cuts.length} cut${cuts.length === 1 ? "" : "s"}, ${plans.length} plan change${plans.length === 1 ? "" : "s"}.`
    : `No price changes recorded across the 100 tracked tools this month.`,
  "",
  ...(rises.length ? ["## Price rises", ...rises.map(line), ""] : []),
  ...(cuts.length ? ["## Price cuts", ...cuts.map(line), ""] : []),
  ...(plans.length ? ["## Plan changes", ...plans.map(planLine), ""] : []),
  ...(other.length ? ["## Other", ...other.map((c) => `- **${c.product_name} ${c.plan}**: ${label(c.field)} price ${c.old == null ? `now listed at ${money(c.currency, c.new)}` : "no longer listed"}`), ""] : []),
  "---",
  `Source: SaaS Pricing MCP price-history log (tracking since ${history.tracking_since}). List prices excluding VAT, from vendors' own pricing pages.`,
  "",
].join("\n");

const { mkdir } = await import("node:fs/promises");
await mkdir(new URL(out.includes("/") ? out.slice(0, out.lastIndexOf("/") + 1) : "./", root), { recursive: true });
await writeFile(new URL(out, root), md);
console.log(`Wrote ${out} (${all.length} changes)`);
