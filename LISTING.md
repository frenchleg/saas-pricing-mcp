# Getting listed

Do these after the server is deployed and `node test/smoke.mjs https://YOUR-URL/mcp` passes.
Replace `YOUR_GITHUB_USERNAME` and `YOUR_SUBDOMAIN` in `server.json` first.

## 1. Official MCP Registry (do this first: several directories pull from it)

```bash
# macOS/Linux
brew install mcp-publisher          # or download a binary from github.com/modelcontextprotocol/registry/releases
mcp-publisher validate              # checks server.json
mcp-publisher login github          # device-code login in the browser
mcp-publisher publish
# confirm it's live:
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.YOUR_GITHUB_USERNAME/saas-pricing"
```

With GitHub login the name must start with `io.github.YOUR_GITHUB_USERNAME/`. When you change tools or the URL, bump `version` in `server.json` and publish again.

## 2. Other directories

All of these are free. Use the copy below.

| Directory | How |
|---|---|
| Smithery (smithery.ai) | Sign in with GitHub, add a server, and choose to connect an existing remote URL. |
| Glama (glama.ai/mcp/servers) | Add the server from its GitHub repo (the repo must be public). |
| PulseMCP (pulsemcp.com) | Picks up the official registry; use its submit form if it hasn't appeared within a week. |
| mcp.so | Submit form on the site. |
| awesome-mcp-servers (github.com/punkpeye/awesome-mcp-servers) | Open a PR adding one line under a fitting category (e.g. "Finance" or "Data"). |

## Copy to paste

**Name:** SaaS Pricing

**One-liner (≤100 chars):** Current SaaS plans, per-seat prices and SSO tiers for 50 tools, in USD and GBP.

**Short description:**
Gives AI agents current, dated list prices for 50 popular SaaS tools (Slack, Notion, Jira, Figma, HubSpot, Google Workspace, Microsoft 365, ChatGPT, Claude, Cursor and more). Look up any product's plans, compare total cost for a team size, or find the cheapest plan that includes SSO, SCIM, audit logs or HIPAA. Prices are in USD and GBP: official UK prices where the vendor publishes them, otherwise converted at the live ECB rate and labelled as converted. Every product carries its source URL and last-checked date. Free, no API key.

**Endpoint:** `https://saas-pricing-mcp.YOUR_SUBDOMAIN.workers.dev/mcp` (Streamable HTTP, no auth)

**Tools:** `get_pricing`, `compare_products`, `search_plans`, `list_products`, `report_outdated`

**Tags:** pricing, saas, software, procurement, comparison, finance, uk, gbp

**Example prompts:**
- "How much would Notion vs Confluence cost for 12 people, billed annually?"
- "Cheapest project management tool with SAML SSO, in GBP"
- "What's on Slack's free plan and what does Pro add?"

**awesome-mcp-servers line:**
```
- [YOUR_GITHUB_USERNAME/saas-pricing-mcp](https://github.com/YOUR_GITHUB_USERNAME/saas-pricing-mcp) ☁️ - Current SaaS plans, per-seat prices and SSO tiers for 50 popular tools in USD and GBP, with team cost comparison.
```
(Check that list's current legend before you open the PR. The emoji meanings change.)
