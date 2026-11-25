# SaaS Pricing MCP

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants current list prices for popular SaaS tools. It covers plans, per-seat costs, limits, key features and free tiers, in USD and GBP.

Ask your assistant things like:

- "What does Notion cost for a team of 12, billed annually?"
- "Which project management tools have SAML SSO for under $15 a user?"
- "Compare Slack, Microsoft Teams and Google Chat for 40 seats in GBP."

Every product includes its source URL and a `last_checked` date, so answers can be checked.

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

## Tools

| Tool | What it does |
|---|---|
| `list_products` | Lists covered products with their cheapest paid price. You can filter by `category`. |
| `get_pricing` | Gives full pricing for one product: every plan's monthly and annual price, how it's charged (per user, flat or by usage), limits, features, free tier or trial, source and last-checked date. |
| `search_plans` | Finds plans across all products by feature (`sso`, `saml`, `scim`, `audit log`, `hipaa`, `api`) and/or a price cap. Results are sorted cheapest first. |
| `compare_products` | Compares 2–8 products for a given number of seats, with monthly and annual totals and seat minimums included. |
| `report_outdated` | Flags a wrong or outdated price, or requests a product that isn't covered. The maintainer reviews each report. |

### Common parameters

- `currency`: `USD` or `GBP`. Without it, prices use the vendor's own currency. GBP uses official UK prices where the vendor publishes them. Otherwise it converts at the live ECB rate, and the result is marked as converted.
- `billing`: `monthly` (the default) or `annual`. Annual gives the per-month price when billed yearly.

## Categories

`accounting` · `ai` · `automation` · `communication` · `crm` · `database` · `design` · `dev-tools` · `ecommerce` · `hosting` · `marketing` · `productivity` · `project-management` · `scheduling` · `security` · `storage` · `support` · `video-audio` · `website-builder`

## Data accuracy

Prices are list prices taken from each vendor's public pricing page and checked regularly. They don't include:

- negotiated or enterprise discounts
- regional pricing other than the US and UK
- taxes such as VAT
- promotions and limited-time offers

Always confirm with the vendor before buying. If something is wrong, use the `report_outdated` tool or [open an issue](../../issues).

## Self-hosting

The server runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/).

```bash
npm install
npx wrangler dev      # run locally at http://localhost:8787/mcp
npx wrangler deploy   # deploy to your own Cloudflare account
```

Put local secrets in `.dev.vars`. That file is listed in `.gitignore`, so it isn't committed.

## Contributing

Pricing corrections, new products and bug fixes are welcome. When you update a price, include the vendor's pricing page URL in your pull request.

## License

[MIT](LICENSE)
