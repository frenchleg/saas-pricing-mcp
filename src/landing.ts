import type { Product } from "./types";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function landingPage(origin: string, products: Product[], categories: string[], version: string, trackingSince: string): string {
  const endpoint = `${origin}/mcp`;
  const byCat = categories
    .map((c) => `<li><b>${esc(c)}</b>: ${products.filter((p) => p.category === c).map((p) => esc(p.name)).join(", ")}</li>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SaaS Pricing MCP: current SaaS prices and compliance facts for AI agents</title>
<meta name="description" content="Free remote MCP server with current list prices, plans, limits and features for ${products.length} popular SaaS tools in USD and GBP, plus SOC 2, ISO 27001, HIPAA and UK/EU data residency facts.">
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1a1a1a}code,pre{background:#f3f3f3;border-radius:6px}code{padding:2px 5px}pre{padding:12px;overflow:auto}h1{font-size:1.6em}small{color:#666}</style></head>
<body>
<h1>SaaS Pricing MCP</h1>
<p>A free remote <a href="https://modelcontextprotocol.io">MCP</a> server that gives AI agents current, dated list prices for ${products.length} popular SaaS tools (plans, per-seat and annual prices, limits, which plan includes SSO), plus vendor-stated compliance facts: SOC 2, ISO 27001, UK Cyber Essentials, HIPAA, UK/EU data residency and whether the vendor trains AI on your data. Prices are in USD and GBP. Official UK prices are used where the vendor publishes them; otherwise prices are converted at the live ECB rate and labelled as converted.</p>
<h2>Connect</h2>
<p>Endpoint (Streamable HTTP, no auth): <code>${esc(endpoint)}</code></p>
<pre>claude mcp add --transport http saas-pricing ${esc(endpoint)}</pre>
<p>Or add it to any MCP client config:</p>
<pre>{ "mcpServers": { "saas-pricing": { "type": "http", "url": "${esc(endpoint)}" } } }</pre>
<h2>Tools</h2>
<ul>
<li><code>get_pricing</code>: every plan for one product, with prices, limits and features</li>
<li><code>compare_products</code>: monthly and annual totals for a team size across products</li>
<li><code>search_plans</code>: cheapest plans with a feature (SSO, SCIM, audit log, HIPAA…) or under a budget</li>
<li><code>get_compliance</code>: a product's certifications, data residency, AI-training stance, trust centre and sub-processor links, with evidence</li>
<li><code>find_compliant_tools</code>: tools meeting all your security requirements, cheapest first (e.g. SOC 2 Type II + EU data residency)</li>
<li><code>price_history</code>: dated log of price rises, cuts and plan changes, tracked since ${esc(trackingSince)}</li>
<li><code>list_products</code>: coverage and starting prices</li>
<li><code>report_outdated</code>: flag a wrong price or request a product</li>
</ul>
<h2>Coverage</h2><ul>${byCat}</ul>
<p><small>Privacy: the server logs which tool was called, the product names requested, the client name/user-agent and country, to improve coverage. No accounts, no personal data, no cookies.</small></p>
<p><small>Dataset ${esc(version)}. List prices excluding tax/VAT, checked against vendor pricing pages. Every product carries its source and last-checked date. Not affiliated with any vendor listed.</small></p>
</body></html>`;
}
