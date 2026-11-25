// Sanity-checks data/products.json. Runs in CI before every deploy.
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../data/products.json", import.meta.url), "utf8"));
const errors = [];
const UNITS = new Set(["per_user", "per_channel", "flat", "usage", "custom"]);
const CUR = new Set(["USD", "GBP"]);
const ids = new Set();
const isNum = (v) => v === null || v === undefined || (typeof v === "number" && v >= 0 && Number.isFinite(v));

if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dataset_version)) errors.push("dataset_version must be YYYY-MM-DD");
for (const p of data.products) {
  const at = `product '${p.id}'`;
  if (!/^[a-z0-9-]+$/.test(p.id ?? "")) errors.push(`${at}: id must be lowercase-kebab`);
  if (ids.has(p.id)) errors.push(`${at}: duplicate id`);
  ids.add(p.id);
  for (const k of ["name", "category", "pricing_url", "currency", "source", "checked"]) if (!p[k]) errors.push(`${at}: missing ${k}`);
  if (!CUR.has(p.currency)) errors.push(`${at}: currency must be USD or GBP`);
  if (!["vendor_page", "secondary"].includes(p.source)) errors.push(`${at}: bad source`);
  if (!/^https:\/\//.test(p.pricing_url)) errors.push(`${at}: pricing_url must be https`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.checked)) errors.push(`${at}: checked must be YYYY-MM-DD`);
  if (new Date(p.checked) > new Date(Date.now() + 86400000)) errors.push(`${at}: checked date is in the future`);
  if (!Array.isArray(p.plans) || !p.plans.length) errors.push(`${at}: no plans`);
  const names = new Set();
  for (const pl of p.plans ?? []) {
    const pat = `${at} plan '${pl.name}'`;
    if (!pl.name) errors.push(`${at}: plan without name`);
    if (names.has(pl.name)) errors.push(`${pat}: duplicate plan name`);
    names.add(pl.name);
    if (!UNITS.has(pl.unit)) errors.push(`${pat}: bad unit '${pl.unit}'`);
    for (const k of ["monthly", "annual_monthly", "gbp_monthly", "gbp_annual_monthly", "min_seats", "included_seats", "max_seats"])
      if (!isNum(pl[k])) errors.push(`${pat}: ${k} must be a non-negative number or null`);
    if (pl.monthly != null && pl.annual_monthly != null && pl.annual_monthly > pl.monthly * 1.01)
      errors.push(`${pat}: annual_monthly (${pl.annual_monthly}) is higher than monthly (${pl.monthly}). Swapped?`);
    if (pl.unit !== "custom" && pl.unit !== "usage" && pl.monthly == null && pl.annual_monthly == null)
      errors.push(`${pat}: priced plan has no price; use unit 'custom' if unpublished`);
    if (!Array.isArray(pl.limits) || !Array.isArray(pl.features)) errors.push(`${pat}: limits/features must be arrays`);
  }
  if (p.free_tier !== null && typeof p.free_tier !== "boolean") errors.push(`${at}: free_tier must be true, false or null`);
  const c = p.compliance;
  if (c) {
    const YN = [null, "yes", "no"];
    for (const k of ["iso27001", "iso42001", "cyber_essentials", "pci_dss", "gdpr", "hipaa", "eu_data_residency", "uk_data_residency"])
      if (!YN.includes(c[k])) errors.push(`${at}: compliance.${k} must be "yes", "no" or null`);
    if (![null, "yes", "no", "type2"].includes(c.soc2)) errors.push(`${at}: compliance.soc2 must be "type2", "yes", "no" or null`);
    if (![null, "no_training", "no_training_business", "opt_out"].includes(c.ai_training)) errors.push(`${at}: bad compliance.ai_training`);
    for (const [k, u] of Object.entries(c.evidence ?? {})) if (!/^https:\/\//.test(u)) errors.push(`${at}: evidence.${k} must be an https URL`);
    for (const k of ["soc2", "iso27001", "iso42001", "cyber_essentials", "pci_dss", "hipaa", "eu_data_residency", "uk_data_residency"])
      if (c[k] && c[k] !== "no" && !c.evidence?.[k]) errors.push(`${at}: compliance.${k} is set but has no evidence URL`);
    if (c.needs_review?.length) errors.push(`${at}: compliance fields need review: ${c.needs_review.join(", ")} (decide in data/trust-overrides.json, then run scripts/apply-trust.mjs)`);
  }
}
if (errors.length) {
  console.error(`✗ ${errors.length} problem(s) in data/products.json:\n- ` + errors.join("\n- "));
  process.exit(1);
}
console.log(`✓ data/products.json OK: ${data.products.length} products, ${data.products.reduce((n, p) => n + p.plans.length, 0)} plans`);
