# SaaS Pricing MCP

A free remote MCP server that gives AI agents current, dated list prices for 50 popular SaaS tools, in USD and GBP.
It runs on Cloudflare Workers (free tier) and logs which tools and products agents ask for, so you can see demand before you charge.

**Tools:** `get_pricing` · `compare_products` · `search_plans` · `list_products` · `report_outdated`

---

## Deploy (about 20 minutes, one time)

You need a GitHub account, a free Cloudflare account, and Node 22+.

```bash
# 1. Install
npm install

# 2. Log in to Cloudflare (opens a browser)
npx wrangler login

# 3. Create the usage-log database, then paste the database_id it prints into wrangler.toml
npx wrangler d1 create saas-pricing-mcp
npm run db:init

# 4. Set a password for your private stats page (make one up)
npx wrangler secret put STATS_KEY

# 5. Deploy. Wrangler prints your URL, e.g. https://saas-pricing-mcp.<you>.workers.dev
npm run deploy

# 6. Test the live server end to end
node test/smoke.mjs https://saas-pricing-mcp.<you>.workers.dev/mcp
```

Try it yourself in Claude Code:
```bash
claude mcp add --transport http saas-pricing https://saas-pricing-mcp.<you>.workers.dev/mcp
```
In Claude's apps, add the same URL as a custom connector.

### Auto-deploy and weekly checks (GitHub)

1. Push this folder to a new GitHub repo. A public repo is needed for Glama and the awesome-list.
2. In the repo go to **Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_API_TOKEN`: create one at dash.cloudflare.com → My Profile → API Tokens with the "Edit Cloudflare Workers" template, plus D1 edit permission.
   - `CLOUDFLARE_ACCOUNT_ID`: shown in the Cloudflare dashboard sidebar.
3. Every push to `main` now validates the data and deploys.
4. Every Monday the **Weekly pricing page check** workflow fetches all pricing pages. If anything changed, it opens a GitHub issue listing the new and removed price figures for each product.

Then follow `LISTING.md` to get into the directories.

---

## Your weekly routine (~30–45 min)

1. **Monday: open the "Pricing review" issue.** For each changed product, open the pricing page and confirm what moved. Many "changes" are promos or banners.
2. **Edit `data/products.json`.** Update the prices, set that product's `checked` to today, and bump `dataset_version`. Commit, and it deploys itself.
   - Shortcut: `ANTHROPIC_API_KEY=... node scripts/propose-update.mjs <id>` drafts the updated entry into `data/proposed/<id>.json` for you to check and paste in.
3. **Check usage:** `https://<your-url>/stats?key=YOUR_STATS_KEY&days=7`
   - `requested_but_not_covered`: products agents asked for that you don't have. **Add the top ones next.** This is the best signal you'll get.
   - `calls_by_tool`: which tools agents actually use. This decides what to charge for later.
   - `sessions_by_client`: which agents connect (Claude, Cursor, etc.).
   - `recent_feedback`: reports from `report_outdated`.
4. **Monthly:** check by hand the pages the bot can't read (listed in the weekly issue, about 14 of them: Atlassian, HubSpot, Google Workspace, Microsoft 365, Canva, ChatGPT and others), and the 6 products marked `"source": "secondary"`.

## Data notes

- All prices are list prices excluding tax/VAT. `monthly` = billed monthly; `annual_monthly` = per-month equivalent when billed yearly; `null` = not published.
- GBP: Xero and Microsoft 365 are stored in GBP as published, and Google Workspace has official UK prices. Everything else is converted from USD at the live ECB rate (cached 6 hours, via frankfurter) and labelled `"price_basis": "converted"`.
- Products where the vendor page couldn't be read (Jira, Confluence, Canva, 1Password, Make, ChatGPT) use dated third-party reports and say so in every response (`data_source: secondary`). Upgrade these to `vendor_page` when you've checked them yourself from a UK browser.
- Run `npm run validate` after editing. It catches swapped monthly/annual values, missing prices and typos.

## Local development

```bash
npx wrangler d1 execute saas-pricing-mcp --local --file=schema.sql
echo "STATS_KEY=localtestkey" > .dev.vars
npm run dev                        # http://127.0.0.1:8787
node test/smoke.mjs                # 20 end-to-end checks with the official MCP client
```

## Later: paid tiers

When `/stats` shows steady use, keep `get_pricing` and `list_products` free and gate the heavier tools (`compare_products`, `search_plans`, or a future price-history tool) behind pay-per-call. Cloudflare's Agents SDK has `paidTool` with x402 for exactly this, and the server already runs on Workers.

## Layout

```
data/products.json        the dataset (edit this)
data/fingerprints.json    page fingerprints from the weekly checker
src/                      Worker + MCP server (index.ts routes, server.ts tools, pricing.ts logic, fx.ts rates)
scripts/                  validate, weekly page check, Claude-assisted update proposer
test/smoke.mjs            end-to-end tests
schema.sql                D1 tables for usage logs
server.json               official MCP registry manifest
LISTING.md                directory submission steps and copy
```
