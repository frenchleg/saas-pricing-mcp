# SaaS Pricing MCP

[![SaaS Pricing MCP on Glama](https://glama.ai/mcp/servers/frenchleg/saas-pricing-mcp/badges/score.svg)](https://glama.ai/mcp/servers/frenchleg/saas-pricing-mcp)

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants current list prices and security & compliance facts for 100 popular SaaS tools. It covers plans, per-seat costs, limits, key features and free tiers, in USD and GBP. It also records what each vendor states about SOC 2, ISO 27001, UK Cyber Essentials, HIPAA, UK and EU data residency, and whether it trains AI on customer data. And it keeps a dated log of price changes, so an assistant can tell you when a tool raised its prices.

Ask your assistant things like:

- "What does Notion cost for a team of 12, billed annually?"
- "Which project management tools have SAML SSO for under $15 a user?"
- "Compare Slack, Microsoft 365 and Google Workspace for 40 seats in GBP."
- "Which CRMs are SOC 2 Type II with EU data residency, cheapest first?"
- "Is Xero Cyber Essentials certified? Does Zoom train AI on our meetings?"
- "Has Slack raised its prices recently? Which SaaS tools changed pricing this month?"

Every price includes its source URL and a `last_checked` date, and every compliance fact links to the vendor page it came from, so answers can be checked.

## Quick start

The server is hosted at:

```
https://saas-pricing-mcp.saas-pricing-mcp.workers.dev/mcp
```

It uses the Streamable HTTP transport and needs no API key.

### Claude Code

```bash
claude mcp add --transport http saas-pricing https://saas-pricing-mcp.saas-pricing-mcp.workers.dev/mcp
```

Add `--scope user` to make it available in all your projects.

### Claude Desktop / claude.ai

Go to **Settings → Connectors → Add custom connector** and paste the URL above.

### Cursor

Add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "saas-pricing": {
      "url": "https://saas-pricing-mcp.saas-pricing-mcp.workers.dev/mcp"
    }
  }
}
```

### Other clients

Any MCP client that supports remote HTTP servers can connect with the URL above. For clients that only support stdio, use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "saas-pricing": {
      "command": "npx",
      "args": ["mcp-remote", "https://saas-pricing-mcp.saas-pricing-mcp.workers.dev/mcp"]
    }
  }
}
```

### Run it locally instead

The same server also runs as a local process over stdio, for clients that prefer that:

```bash
git clone https://github.com/frenchleg/saas-pricing-mcp && cd saas-pricing-mcp
npm install && npm run build:stdio
```

Then point your client at `node /path/to/saas-pricing-mcp/dist/stdio.mjs`. Prices are the dataset in the repo, so `git pull` and rebuild to update them.

## Tools

| Tool | What it does |
|---|---|
| `list_products` | Lists covered products with their cheapest paid price. You can filter by `category`. |
| `get_pricing` | Gives full pricing for one product: every plan's monthly and annual price, how it's charged (per user, flat or by usage), limits, features, free tier or trial, source and last-checked date. |
| `search_plans` | Finds plans across all products by feature (`sso`, `saml`, `scim`, `audit log`, `hipaa`, `api`) and/or a price cap. Results are sorted cheapest first. |
| `compare_products` | Compares 2–8 products for a given number of seats, with monthly and annual totals and seat minimums included, plus a one-line compliance summary for each. |
| `get_compliance` | Gives one product's security and compliance facts: SOC 2 (and whether Type II), ISO 27001, ISO 42001, UK Cyber Essentials, PCI DSS, GDPR, HIPAA/BAA, UK and EU data residency, AI training on customer data, and links to its trust centre, sub-processor list and DPA. Each fact has an evidence URL. |
| `find_compliant_tools` | Finds products that meet all the requirements you give (for example `soc2_type2` + `eu_data_residency` + `no_ai_training`), optionally within a category and price cap. Results are sorted by cheapest paid plan, with near-misses listed where a fact is unknown. |
| `price_history` | Gives the dated log of price changes: rises, cuts, plans added or removed, with old and new prices and the % change. You can filter by `product`, `category` or `since` (a date). Fixes to this dataset's own mistakes are left out unless you set `include_corrections`. `get_pricing` also shows each product's latest changes. |
| `report_outdated` | Flags a wrong or outdated price or compliance fact, or requests a product that isn't covered. The maintainer reviews each report. |

### Common parameters

- `currency`: `USD` or `GBP`. Without it, prices use the vendor's own currency. GBP uses official UK prices where the vendor publishes them. Otherwise it converts at the live ECB rate, and the result is marked as converted.
- `billing`: `monthly` (the default) or `annual`. Annual gives the per-month price when billed yearly.
- `requirements` (for `find_compliant_tools`): any of `soc2`, `soc2_type2`, `iso27001`, `iso42001`, `cyber_essentials`, `pci_dss`, `gdpr`, `hipaa`, `eu_data_residency`, `uk_data_residency`, `no_ai_training`.

## Coverage

100 products across 24 categories:

| Category | Products |
|---|---|
| `accounting` | Xero (UK), FreeAgent, Sage Accounting (UK), QuickBooks Online (UK), Dext |
| `ai` | ChatGPT, Claude, Cursor, GitHub Copilot, Perplexity, Lovable |
| `analytics` | Hotjar (Contentsquare), PostHog |
| `automation` | Zapier, Make |
| `communication` | Slack, Zoom Workplace |
| `crm` | Pipedrive, Capsule CRM, Salesforce Sales Cloud, Zoho CRM |
| `database` | Airtable, Supabase, Neon |
| `design` | Miro, Figma, Canva, Adobe Creative Cloud (UK) |
| `dev-tools` | GitHub, GitLab, Sentry, Postman, Resend |
| `documents` | DocuSign eSignature, PandaDoc |
| `ecommerce` | Shopify |
| `finance` | Tide Business Account, GoCardless, Pleo |
| `forms` | Typeform, Jotform, SurveyMonkey |
| `hosting` | Vercel, Netlify, Render, Railway, DigitalOcean Droplets, Cloudflare |
| `hr` | BrightHR, Breathe HR, CharlieHR, Deel |
| `marketing` | HubSpot Marketing Hub, Mailchimp, Kit (ConvertKit), Buffer, Klaviyo, ActiveCampaign, Brevo, MailerLite, Hootsuite, Sprout Social, Later, Semrush, Ahrefs |
| `productivity` | Notion, Confluence, Google Workspace, Microsoft 365 Business (UK), Grammarly, Otter.ai, Todoist |
| `project-management` | Asana, Trello, monday.com, ClickUp, Linear, Jira, Smartsheet, Wrike, Basecamp |
| `scheduling` | Calendly, RotaCloud, Deputy (UK) |
| `security` | 1Password, Bitwarden |
| `storage` | Dropbox, Box |
| `support` | Intercom, Zendesk, Freshdesk, Help Scout |
| `video-audio` | Loom, ElevenLabs, Synthesia, Descript |
| `website-builder` | Framer, Webflow, Squarespace, Wix |

UK tools such as Xero, FreeAgent, Sage, QuickBooks UK, Tide, BrightHR, Breathe, CharlieHR, RotaCloud and Deputy are priced in GBP as published. Salesforce, Smartsheet and Google Workspace also publish official UK prices, which are used when you ask for GBP.

Missing a tool? Ask for it with `report_outdated`. Requests are counted and the most-requested products are added first.

## Data accuracy

Prices are list prices taken from each vendor's public pricing page and checked regularly. They don't include:

- negotiated or enterprise discounts
- regional pricing other than the US and UK
- taxes such as VAT
- promotions and limited-time offers

A few products list prices that load in ways the checker can't read (Jira, QuickBooks UK, Zoho CRM, ActiveCampaign, Perplexity). Those use dated third-party sources and say so in every answer (`data_source: secondary`). Adobe's UK prices include VAT and are flagged as such.

Always confirm with the vendor before buying. If something is wrong, use the `report_outdated` tool or [open an issue](../../issues).

### Price history

Every change to a price in `data/products.json` is recorded automatically in `data/price-history.json`, with the date, the old and new price, and the % change. Tracking started on 26 November 2026, so there's no history from before then.

The log keeps two kinds of entry apart:

- **`change`**: the vendor changed its price or plans.
- **`correction`**: this dataset had a price wrong and it was fixed. Corrections aren't price changes, so `price_history` hides them unless you ask for them.

### Compliance facts

Compliance data comes from each vendor's own security, trust and legal pages:

- **`yes`** means the vendor states it on its own public pages. Every `yes` has an evidence link.
- **`no`** is used only where the vendor explicitly says it doesn't (for example, Basecamp states it has no company-level SOC 2 audit and doesn't sign BAAs).
- **`null`** means not found on the pages checked. It may still be true, so check the vendor's trust centre.

Certifications are only credited when the statement is about the vendor itself, not its hosting provider. HIPAA, data residency and AI-training facts are reviewed by hand, because the wording is often nuanced (Enterprise-only, add-on, opt-out). Compliance pages are re-scanned monthly.

This is a starting point for vendor due diligence, not a substitute for it. Confirm certifications and contract terms (DPA, BAA) with the vendor.

## Self-hosting

The server runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/).

The quickest way is the deploy script. It installs dependencies, logs you in to Cloudflare, creates the usage-log database, deploys, and runs the end-to-end tests against your live server:

```bash
./deploy.sh
```

Or step by step:

```bash
npm install
npx wrangler d1 create saas-pricing-mcp                                      # paste the id into wrangler.toml
npx wrangler d1 execute saas-pricing-mcp --remote --file=schema.sql
npx wrangler dev      # run locally at http://localhost:8787/mcp
npx wrangler deploy   # deploy to your own Cloudflare account
node test/smoke.mjs https://<your-worker>.workers.dev/mcp                    # 42 end-to-end checks
```

Put local secrets in `.dev.vars`. That file is listed in `.gitignore`, so it isn't committed.

To see who is using your server, set a stats key with `npx wrangler secret put STATS_KEY`, then open `https://<your-worker>.workers.dev/stats` in a browser. The dashboard asks for the key once, remembers it in that browser, and shows tool calls, connecting clients, requested and missing products, agent reports and failed requests. Scripts can fetch the same data as JSON with an `Authorization: Bearer <key>` header.

Useful scripts:

- `npm run validate` checks `data/products.json`, including that every compliance fact has an evidence link.
- `node scripts/check-pages.mjs` fingerprints every pricing page and reports which ones changed (runs weekly in GitHub Actions).
- `npm run record-history` compares `data/products.json` with the last snapshot and logs any price changes. It runs on every push to `main`, then commits the updated log back. If the commit message contains "correction" or "fix data", the changes are logged as corrections. To run it by hand: `node scripts/record-history.mjs --kind correction --note "reason"`.
- `npm run monthly-report` writes a markdown summary of last month's price changes to `reports/YYYY-MM.md` (or pass a month: `node scripts/monthly-report.mjs 2026-12`).
- The listing in the official [MCP Registry](https://registry.modelcontextprotocol.io) is published from `server.json` by GitHub Actions. Bump `version` in `server.json` and push to `main` to update it.
- `node scripts/scan-trust.mjs` then `node scripts/apply-trust.mjs` re-scan vendors' trust pages and rebuild the compliance data (runs monthly). Reviewed decisions live in `data/trust-overrides.json`.

## Contributing

Pricing corrections, compliance corrections, new products and bug fixes are welcome. When you update a price, include the vendor's pricing page URL in your pull request. If you're fixing a price that was wrong in this dataset (rather than one the vendor changed), put "correction" in the commit message so it's logged as a correction, not a price change. For a compliance fact, include the vendor page that states it, and add your decision to `data/trust-overrides.json` so the monthly re-scan doesn't overwrite it.

## License

[GNU Affero General Public License v3.0](LICENSE)
