// Weekly change detection. Fetches every pricing page, pulls out the price-like tokens
// ($12, £5.90, 9.99/mo, "per user"...), and compares them with the last run's fingerprint.
// Writes data/fingerprints.json and a markdown report (report.md) listing what changed.
//
//   node scripts/check-pages.mjs            # check all products
//   node scripts/check-pages.mjs notion zoom
//
// The report is what you review each week. A change does NOT update prices automatically;
// open the page, confirm, edit data/products.json (or run scripts/propose-update.mjs), commit.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { visibleText, priceTokens } from "./check-pages-lib.mjs";

const STALE_DAYS = 45;
const root = new URL("..", import.meta.url);
const data = JSON.parse(await readFile(new URL("data/products.json", root), "utf8"));
const fpPath = new URL("data/fingerprints.json", root);
const previous = JSON.parse(await readFile(fpPath, "utf8").catch(() => "{}"));

async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const only = process.argv.slice(2);
const targets = data.products.filter((p) => !only.length || only.includes(p.id));
const now = new Date();
const results = [];

for (const p of targets) {
  try {
    const tokens = priceTokens(visibleText(await fetchPage(p.pricing_url)));
    const hash = createHash("sha256").update(tokens.join("|")).digest("hex").slice(0, 16);
    const prev = previous[p.id];
    const status = tokens.length < 3 ? "unreadable" : !prev ? "baseline" : prev.hash === hash ? "unchanged" : "changed";
    const added = prev ? tokens.filter((t) => !prev.tokens.includes(t)) : [];
    const removed = prev ? prev.tokens.filter((t) => !tokens.includes(t)) : [];
    results.push({ id: p.id, name: p.name, url: p.pricing_url, status, added, removed, count: tokens.length });
    if (status !== "unreadable") previous[p.id] = { hash, tokens, at: now.toISOString() };
  } catch (e) {
    results.push({ id: p.id, name: p.name, url: p.pricing_url, status: "error", error: String(e.message ?? e) });
  }
  await new Promise((r) => setTimeout(r, 750)); // be polite
}

const stale = data.products.filter((p) => (now - new Date(p.checked)) / 86400000 > STALE_DAYS);
await writeFile(fpPath, JSON.stringify(previous, null, 1) + "\n");

const changed = results.filter((r) => r.status === "changed");
const problems = results.filter((r) => r.status === "error" || r.status === "unreadable");
const lines = [
  `# Pricing page check: ${now.toISOString().slice(0, 10)}`,
  "",
  `Checked ${results.length} pages: **${changed.length} changed**, ${results.filter((r) => r.status === "unchanged").length} unchanged, ${results.filter((r) => r.status === "baseline").length} new baseline, ${problems.length} need a manual look.`,
  "",
];
if (changed.length) {
  lines.push("## Changed: review these", "");
  for (const r of changed) {
    lines.push(`- [ ] **${r.name}** (\`${r.id}\`): ${r.url}`);
    if (r.added.length) lines.push(`  - new on page: ${r.added.slice(0, 15).join(", ")}`);
    if (r.removed.length) lines.push(`  - gone from page: ${r.removed.slice(0, 15).join(", ")}`);
  }
  lines.push("");
}
if (problems.length) {
  lines.push("## Couldn't read automatically (JS-rendered or blocked): check by hand monthly", "");
  for (const r of problems) lines.push(`- ${r.name}: ${r.url} (${r.status}${r.error ? `: ${r.error}` : `, ${r.count} price tokens`})`);
  lines.push("");
}
if (stale.length) {
  lines.push(`## Not re-verified in ${STALE_DAYS}+ days`, "", ...stale.map((p) => `- ${p.name}: last checked ${p.checked}`), "");
}
lines.push("After confirming a change: edit `data/products.json`, set that product's `checked` date, bump `dataset_version`, commit. The deploy workflow publishes it.");
await writeFile(new URL("report.md", root), lines.join("\n") + "\n");
console.log(lines.join("\n"));
// exit code 0 always; the workflow decides whether to open an issue
await writeFile(new URL("check-summary.json", root), JSON.stringify({ changed: changed.length, problems: problems.length, stale: stale.length }));
