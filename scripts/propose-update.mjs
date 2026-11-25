// Optional helper: asks Claude to read a vendor's pricing page and propose an updated entry.
// It never edits data/products.json itself. It writes data/proposed/<id>.json and prints a diff for you to review.
//
//   ANTHROPIC_API_KEY=... node scripts/propose-update.mjs notion
//
// Cost is roughly a few pence per product. JS-rendered pages (Atlassian, Make, ChatGPT) won't work;
// paste the page text into a file and pass it as the second argument instead:
//   node scripts/propose-update.mjs jira ./jira-page.txt
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { visibleText } from "./check-pages-lib.mjs";

const [id, textFile] = process.argv.slice(2);
if (!id) throw new Error("usage: node scripts/propose-update.mjs <product-id> [page-text-file]");
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error("Set ANTHROPIC_API_KEY");

const root = new URL("..", import.meta.url);
const data = JSON.parse(await readFile(new URL("data/products.json", root), "utf8"));
const current = data.products.find((p) => p.id === id);
if (!current) throw new Error(`Unknown product id ${id}`);

let pageText;
if (textFile) pageText = await readFile(textFile, "utf8");
else {
  const res = await fetch(current.pricing_url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/131.0", "Accept-Language": "en-US" } });
  pageText = visibleText(await res.text());
}
pageText = pageText.slice(0, 60000);

const prompt = `Here is the current JSON entry for ${current.name} in a SaaS pricing dataset, followed by the text of the vendor's pricing page fetched today.

Update the entry so it matches the page exactly. Rules:
- Keep the same schema and field names. Only change values the page supports.
- "monthly" = price per month when billed monthly; "annual_monthly" = per-month equivalent when billed annually. Use null if the page doesn't show it. Never guess.
- Keep limits/features short (max 5 each), and mention SSO/SAML if present.
- Set "checked" to "${new Date().toISOString().slice(0, 10)}" and "source" to "vendor_page".
- Reply with ONLY the JSON object, no commentary.

CURRENT ENTRY:
${JSON.stringify(current, null, 1)}

PAGE TEXT:
${pageText}`;

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
const body = await res.json();
const text = body.content.map((c) => c.text ?? "").join("").trim().replace(/^```json\s*|\s*```$/g, "");
const proposed = JSON.parse(text);

await mkdir(new URL("data/proposed/", root), { recursive: true });
await writeFile(new URL(`data/proposed/${id}.json`, root), JSON.stringify(proposed, null, 2) + "\n");

// tiny diff of plan prices
for (const pl of proposed.plans ?? []) {
  const old = current.plans.find((o) => o.name === pl.name);
  const fmt = (x) => (x ? `${x.monthly ?? "-"} / ${x.annual_monthly ?? "-"}` : "(new plan)");
  const changed = !old || old.monthly !== pl.monthly || old.annual_monthly !== pl.annual_monthly;
  console.log(`${changed ? "*" : " "} ${pl.name.padEnd(28)} ${fmt(old).padEnd(16)} -> ${fmt(pl)}`);
}
for (const o of current.plans) if (!proposed.plans?.some((p) => p.name === o.name)) console.log(`- ${o.name} (removed)`);
console.log(`\nWrote data/proposed/${id}.json. Check it against ${current.pricing_url}, then copy it into data/products.json.`);
