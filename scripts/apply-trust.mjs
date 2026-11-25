// Builds each product's `compliance` block from data/trust-scan.json (automatic, evidence-backed)
// plus data/trust-overrides.json (your reviewed decisions, which always win).
//
//   node scripts/apply-trust.mjs
//
// Rules:
// - A certification is "yes" only if the vendor's own page states it; "type2" for SOC 2 Type II.
// - HIPAA, data residency and AI-training are nuanced, so they are NEVER set from keywords alone:
//   they come only from overrides. Keyword hits for them are listed in needs_review instead.
// - Nothing is ever "no" unless an override says so (i.e. the vendor explicitly states it).
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const P = new URL("data/products.json", root);
const data = JSON.parse(await readFile(P, "utf8"));
const scan = JSON.parse(await readFile(new URL("data/trust-scan.json", root), "utf8"));
const overrides = JSON.parse(await readFile(new URL("data/trust-overrides.json", root), "utf8"));

const NEG = /\b(not|n't|no|out of scope|in progress|working towards?|plan(?:ning)? to|cannot|pursuing)\b/i;
const CERT_KEYS = ["iso27001", "iso42001", "cyber_essentials", "pci_dss", "gdpr"];
const NUANCED = { hipaa: ["hipaa", "baa"], eu_data_residency: ["eu_residency"], uk_data_residency: ["uk_residency"], ai_training: ["ai_no_training", "ai_opt_out"] };

let reviewCount = 0;
for (const p of data.products) {
  const s = scan[p.id];
  const ov = overrides[p.id] ?? {};
  const hits = s?.hits ?? {};
  // prefer evidence from trust/security pages over legal boilerplate (DPAs often describe suppliers' audits)
  const positive = (k) => {
    const ok = (hits[k] ?? []).filter((h) => !NEG.test(h.snippet));
    return ok.find((h) => /trust|security|compliance/i.test(h.url) && !/legal|dpa|data-processing|privacy-policy/i.test(h.url)) ?? ok[0];
  };
  const c = {
    checked: s?.scanned ?? null,
    trust_url: s?.links?.trust_url ?? null,
    subprocessors_url: s?.links?.subprocessors_url ?? null,
    dpa_url: s?.links?.dpa_url ?? null,
    soc2: null,
    iso27001: null,
    iso42001: null,
    cyber_essentials: null,
    pci_dss: null,
    gdpr: null,
    hipaa: null,
    eu_data_residency: null,
    uk_data_residency: null,
    ai_training: null,
    notes: [],
    evidence: {},
    needs_review: [],
  };
  const t2 = positive("soc2_type2");
  const s2 = positive("soc2");
  if (t2) { c.soc2 = "type2"; c.evidence.soc2 = t2.url; } else if (s2) { c.soc2 = "yes"; c.evidence.soc2 = s2.url; }
  for (const k of CERT_KEYS) {
    const h = positive(k);
    if (h) { c[k] = "yes"; c.evidence[k] = h.url; }
    else if (hits[k]?.length) c.needs_review.push(k);
  }
  if ((hits.soc2?.length || hits.soc2_type2?.length) && !c.soc2) c.needs_review.push("soc2");
  for (const [field, keys] of Object.entries(NUANCED)) {
    const h = keys.flatMap((k) => hits[k] ?? [])[0];
    if (h) c.evidence[field] = h.url;
    if (h && !(field in ov)) c.needs_review.push(field);
  }
  // reviewed decisions win
  for (const [k, v] of Object.entries(ov)) {
    if (k.startsWith("_")) continue;
    c[k] = v;
    if (v === null) delete c.evidence[k];
    else if (!c.evidence[k]) {
      const scanKey = { soc2: "soc2_type2", hipaa: "hipaa", eu_data_residency: "eu_residency", uk_data_residency: "uk_residency" }[k] ?? k;
      const h = (hits[scanKey] ?? hits[k] ?? [])[0];
      if (ov._evidence_url) c.evidence[k] = ov._evidence_url;
      else if (h) c.evidence[k] = h.url;
    }
  }
  if (ov._evidence_ai) c.evidence.ai_training = ov._evidence_ai;
  for (const [k, u] of Object.entries(ov._evidence ?? {})) if (u && c[k] != null) c.evidence[k] = u;
  for (const k of ["_note", "_note_hipaa", "_note_eu", "_note_uk", "_note_ai"]) if (ov[k]) c.notes.push(ov[k]);
  if (!s || !s.pages.some((x) => x.status === 200)) c.notes.push("Vendor's security pages could not be read automatically; check its trust centre.");
  c.notes = c.notes.join(" ") || null;
  c.needs_review = [...new Set(c.needs_review)].filter((k) => !(k in ov));
  if (!c.needs_review.length) delete c.needs_review; else reviewCount++;
  p.compliance = c;
}
await writeFile(P, JSON.stringify(data, null, 2) + "\n");
const count = (f, v) => data.products.filter((p) => (v ? p.compliance[f] === v : p.compliance[f] != null)).length;
console.log(`compliance written for ${data.products.length} products`);
console.log(`soc2 ${count("soc2")} (type2 ${count("soc2", "type2")}) · iso27001 ${count("iso27001", "yes")} · cyber_essentials ${count("cyber_essentials", "yes")} · hipaa yes ${count("hipaa", "yes")} / no ${count("hipaa", "no")} · eu residency ${count("eu_data_residency", "yes")} · uk residency ${count("uk_data_residency", "yes")} · ai_training known ${count("ai_training")}`);
console.log(`${reviewCount} products have fields flagged needs_review`);
