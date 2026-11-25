// Scans each vendor's own security / trust / legal pages for compliance statements and records
// evidence (page URL + short snippet). It never asserts a negative: anything not found stays null.
//
//   node scripts/scan-trust.mjs                # all products -> data/trust-scan.json
//   node scripts/scan-trust.mjs notion slack   # just these
//
// The scan is the raw material. scripts/apply-trust.mjs turns it into the `compliance` block in
// data/products.json, and you review anything marked needs_review.
import { readFile, writeFile } from "node:fs/promises";
import { visibleText } from "./check-pages-lib.mjs";

const root = new URL("..", import.meta.url);
const data = JSON.parse(await readFile(new URL("data/products.json", root), "utf8"));
const seeds = JSON.parse(await readFile(new URL("data/trust-seeds.json", root), "utf8"));
const outPath = new URL("data/trust-scan.json", root);
const previous = JSON.parse(await readFile(outPath, "utf8").catch(() => "{}"));

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const GUESS_PATHS = ["/security", "/trust", "/legal/subprocessors", "/privacy"];
const LINK_RE = /(security|trust|compliance|sub-?processors?|data-processing|\bdpa\b|gdpr|privacy|ai-principles|responsible-ai)/i;

export const PATTERNS = {
  soc2_type2: /SOC\s?2(?:®)?\s*(?:\(\s*)?Type\s*(?:II|2)\b/i,
  soc2: /\bSOC\s?2\b/i,
  iso27001: /ISO(?:\/IEC)?\s*27001/i,
  iso42001: /ISO(?:\/IEC)?\s*42001/i,
  cyber_essentials: /Cyber\s+Essentials/i,
  pci_dss: /PCI[\s-]?DSS/i,
  hipaa: /\bHIPAA\b/i,
  baa: /Business\s+Associate\s+Agreement|\bBAAs?\b/i,
  gdpr: /\bGDPR\b/i,
  eu_residency: /(EU|European)\s+(data\s+)?(residency|region|hosting|data\s*cent(?:er|re)s?)|data\s+residency[^.]{0,60}\b(EU|Europe)|(?:store|host)(?:d|s|ed)?\s+[^.]{0,40}\bin\s+(the\s+)?(EU|European Union|Europe)\b/i,
  uk_residency: /\bUK\s+(data\s+)?(residency|region|hosting|data\s*cent(?:er|re)s?)|data\s+residency[^.]{0,60}\b(UK|United Kingdom)\b|(?:store|host)(?:d|s|ed)?\s+[^.]{0,40}\bin\s+the\s+(UK|United Kingdom)\b/i,
  ai_no_training: /(?:do(?:es)?\s+not|don['’]t|never|will\s+not|won['’]t|not)\s+(?:use\s+[^.]{0,60}\s+to\s+train|train\s+[^.]{0,40}(?:on|with)\s+(?:your|customer))/i,
  ai_opt_out: /opt[\s-]?out[^.]{0,80}\btrain|\btrain[^.]{0,80}opt[\s-]?out/i,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9", Accept: "text/html" } });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !ct.includes("html")) return { url, final: res.url, status: res.status, html: "" };
    return { url, final: res.url, status: res.status, html: await res.text() };
  } catch (e) {
    return { url, final: url, status: 0, html: "", error: String(e.message ?? e) };
  }
}

function sameSite(a, b) {
  const base = (h) => h.split(".").slice(-2).join(".");
  try { return base(new URL(a).hostname) === base(new URL(b).hostname); } catch { return false; }
}

function links(html, from) {
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, " ");
    if (!LINK_RE.test(m[1]) && !LINK_RE.test(text)) continue;
    try {
      const u = new URL(m[1], from);
      if (u.protocol === "https:" && sameSite(u.href, from)) out.add(u.href.replace(/\/$/, ""));
    } catch {}
  }
  return [...out];
}

function snippet(text, idx, len) {
  return text.slice(Math.max(0, idx - 70), idx + len + 70).replace(/\s+/g, " ").trim();
}

async function scan(p) {
  const origin = new URL(seeds[p.id]?.home ?? p.pricing_url).origin;
  const queue = [...(seeds[p.id]?.urls ?? []), ...GUESS_PATHS.map((x) => origin + x)];
  const home = await get(origin);
  for (const l of links(home.html, home.final || origin)) queue.push(l);
  const seen = new Set();
  const pages = [];
  const hits = {};
  const found = { subprocessors_url: null, dpa_url: null, trust_url: null };
  let fetched = 0;
  for (const url of queue) {
    if (fetched >= 12) break;
    const key = url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const page = await get(url);
    fetched++;
    pages.push({ url, status: page.status });
    if (!page.html) continue;
    const text = visibleText(page.html);
    const where = page.final || url;
    if (!found.subprocessors_url && /sub-?processors?/i.test(where)) found.subprocessors_url = where;
    if (!found.dpa_url && /(dpa|data-processing)/i.test(where)) found.dpa_url = where;
    if (!found.trust_url && /(trust|security)/i.test(where) && text.length > 800) found.trust_url = where;
    for (const [k, re] of Object.entries(PATTERNS)) {
      const m = text.match(re);
      if (!m) continue;
      hits[k] ??= [];
      if (hits[k].length < 2 && !hits[k].some((h) => h.url === where)) hits[k].push({ url: where, snippet: snippet(text, m.index, m[0].length) });
    }
    // follow a second hop from trust/security pages (sub-processor and DPA links usually live there)
    if (/(trust|security|legal|privacy)/i.test(where)) for (const l of links(page.html, where)) if (!queue.includes(l)) queue.push(l);
    await sleep(250);
  }
  return { id: p.id, scanned: new Date().toISOString().slice(0, 10), origin, pages, links: found, hits };
}

const only = process.argv.slice(2);
const targets = data.products.filter((p) => !only.length || only.includes(p.id));
const results = { ...previous };
const CONCURRENCY = 6;
let i = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < targets.length) {
      const p = targets[i++];
      results[p.id] = await scan(p);
      const h = Object.keys(results[p.id].hits);
      console.log(`${p.id.padEnd(24)} pages ${String(results[p.id].pages.filter((x) => x.status === 200).length).padStart(2)}/${results[p.id].pages.length}  ${h.join(" ") || "(nothing found)"}`);
    }
  }),
);
await writeFile(outPath, JSON.stringify(results, null, 1) + "\n");
