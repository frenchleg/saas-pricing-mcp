// Records price changes into data/price-history.json by comparing data/products.json
// with the last snapshot (data/price-snapshot.json), then updates the snapshot.
//
//   node scripts/record-history.mjs                      # record changes as real price changes
//   node scripts/record-history.mjs --kind correction    # record them as data corrections instead
//   node scripts/record-history.mjs --note "Slack raised Pro"   # attach a note
//
// In CI it runs automatically on every push to main. If the commit message contains
// "correction" or "fix data", changes are tagged kind=correction, so fixes to our own
// mistakes are kept out of the "what changed in SaaS pricing" feed.
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = async (p, fallback) => JSON.parse(await readFile(new URL(p, root), "utf8").catch(() => JSON.stringify(fallback)));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const today = opt("date") ?? new Date().toISOString().slice(0, 10);
const kind = opt("kind") ?? "change";
const note = opt("note") ?? null;
if (!["change", "correction"].includes(kind)) throw new Error("--kind must be change or correction");

const FIELDS = ["monthly", "annual_monthly", "gbp_monthly", "gbp_annual_monthly"];

/** Compact price map: product -> { name, currency, plans: { planName: {monthly, annual_monthly, ...} } } */
export function snapshotOf(data) {
  const out = {};
  for (const p of data.products) {
    out[p.id] = { name: p.name, category: p.category, currency: p.currency, plans: {} };
    for (const pl of p.plans) {
      const row = {};
      for (const f of FIELDS) if (pl[f] != null) row[f] = pl[f];
      out[p.id].plans[pl.name] = row;
    }
  }
  return out;
}

export function diff(prev, next, { date, kind, note }) {
  const changes = [];
  const base = (id, p) => ({ date, kind, product: id, product_name: p.name, category: p.category, ...(note ? { note } : {}) });
  for (const [id, p] of Object.entries(next)) {
    const old = prev[id];
    if (!old) { changes.push({ ...base(id, p), type: "product_added" }); continue; }
    for (const [plan, row] of Object.entries(p.plans)) {
      const was = old.plans[plan];
      if (!was) { changes.push({ ...base(id, p), type: "plan_added", plan, new: row }); continue; }
      for (const f of FIELDS) {
        if ((was[f] ?? null) === (row[f] ?? null)) continue;
        const currency = f.startsWith("gbp_") ? "GBP" : p.currency;
        const from = was[f] ?? null, to = row[f] ?? null;
        const pct = from && to ? Math.round(((to - from) / from) * 1000) / 10 : null;
        changes.push({ ...base(id, p), type: "price_change", plan, field: f.replace("gbp_", ""), currency, old: from, new: to, pct_change: pct });
      }
    }
    for (const plan of Object.keys(old.plans)) if (!(plan in p.plans)) changes.push({ ...base(id, p), type: "plan_removed", plan, old: old.plans[plan] });
  }
  for (const id of Object.keys(prev)) if (!(id in next)) changes.push({ date, kind, product: id, product_name: prev[id].name, category: prev[id].category, type: "product_removed" });
  return changes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = await read("data/products.json", null);
  const next = snapshotOf(data);
  const snap = await read("data/price-snapshot.json", null);
  const history = await read("data/price-history.json", { tracking_since: today, changes: [] });
  if (!snap) {
    await writeFile(new URL("data/price-snapshot.json", root), JSON.stringify({ as_of: today, prices: next }, null, 1) + "\n");
    await writeFile(new URL("data/price-history.json", root), JSON.stringify({ tracking_since: today, changes: [] }, null, 1) + "\n");
    console.log(`Baseline snapshot created (${Object.keys(next).length} products). Tracking from ${today}.`);
    process.exit(0);
  }
  const changes = diff(snap.prices, next, { date: today, kind, note });
  if (!changes.length) { console.log("No price changes since last snapshot."); process.exit(0); }
  history.changes.push(...changes);
  await writeFile(new URL("data/price-history.json", root), JSON.stringify(history, null, 1) + "\n");
  await writeFile(new URL("data/price-snapshot.json", root), JSON.stringify({ as_of: today, prices: next }, null, 1) + "\n");
  console.log(`Recorded ${changes.length} ${kind}(s):`);
  for (const c of changes) console.log(`  ${c.type.padEnd(14)} ${c.product} ${c.plan ?? ""} ${c.field ?? ""} ${c.old ?? ""} -> ${c.new ?? ""}`.replace(/\[object Object\]/g, "…"));
}
