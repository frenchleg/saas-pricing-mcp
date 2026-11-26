// Unit test for the price-history recorder: node test/history.test.mjs
import assert from "node:assert/strict";
import { snapshotOf, diff } from "../scripts/record-history.mjs";
const base = { products: [{ id: "x", name: "X", category: "ai", currency: "USD", plans: [{ name: "Pro", monthly: 10, annual_monthly: 8 }, { name: "Old", monthly: 5 }] }] };
const next = { products: [{ id: "x", name: "X", category: "ai", currency: "USD", plans: [{ name: "Pro", monthly: 12, annual_monthly: 8, gbp_monthly: 9 }, { name: "Team", monthly: 30 }] }, { id: "y", name: "Y", category: "ai", currency: "GBP", plans: [] }] };
const c = diff(snapshotOf(base).valueOf(), snapshotOf(next), { date: "2026-12-01", kind: "change", note: null });
const find = (t, extra = {}) => c.find((x) => x.type === t && Object.entries(extra).every(([k, v]) => x[k] === v));
assert.equal(find("price_change", { field: "monthly", currency: "USD" }).pct_change, 20, "monthly 10->12 is +20%");
assert.equal(find("price_change", { field: "monthly", currency: "GBP" }).old, null, "new official GBP price recorded");
assert.ok(find("plan_added", { plan: "Team" }), "plan added");
assert.ok(find("plan_removed", { plan: "Old" }), "plan removed");
assert.ok(find("product_added", { product: "y" }), "product added");
assert.ok(!c.some((x) => x.field === "annual_monthly"), "unchanged field not recorded");
const none = diff(snapshotOf(next), snapshotOf(next), { date: "2026-12-01", kind: "change" });
assert.equal(none.length, 0, "no changes when identical");
console.log("history recorder: 7 checks passed");
