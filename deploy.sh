#!/usr/bin/env bash
# One-command deploy for SaaS Pricing MCP. Run it from Terminal:
#   cd ~/repositories/saas-pricing-mcp && ./deploy.sh
# Safe to re-run: it reuses the database and stats password if they already exist.
set -euo pipefail
cd "$(dirname "$0")"
export WRANGLER_SEND_METRICS=false
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

command -v node >/dev/null || { echo "Node.js is needed: install the LTS version from https://nodejs.org, then run ./deploy.sh again."; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "Node 20 or newer is needed (you have $(node -v))."; exit 1; }

say "1/7  Installing dependencies"
npm ci --no-audit --no-fund --loglevel=error

say "2/7  Cloudflare login (a browser window opens; approve it, then come back here)"
if ! npx wrangler whoami 2>/dev/null | grep -qi "logged in"; then npx wrangler login; fi

d1_id() { npx wrangler d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const x=JSON.parse(s).find(d=>d.name==="saas-pricing-mcp");console.log(x?(x.uuid||x.id||""):"")}catch{console.log("")}})'; }

say "3/7  Usage-log database"
if grep -q REPLACE_WITH_YOUR_D1_DATABASE_ID wrangler.toml; then
  ID="$(d1_id)"
  if [ -z "$ID" ]; then npx wrangler d1 create saas-pricing-mcp >/dev/null; ID="$(d1_id)"; fi
  [ -n "$ID" ] || { echo "Couldn't read the database id. Run: npx wrangler d1 list, and paste the id into wrangler.toml."; exit 1; }
  node -e 'const fs=require("fs");fs.writeFileSync("wrangler.toml",fs.readFileSync("wrangler.toml","utf8").replace("REPLACE_WITH_YOUR_D1_DATABASE_ID",process.argv[1]))' "$ID"
  echo "Database id $ID saved to wrangler.toml"
fi
npx wrangler d1 execute saas-pricing-mcp --remote --file=schema.sql --yes >/dev/null
echo "Tables ready"

say "4/7  Deploying the Worker"
OUT="$(npx wrangler deploy 2>&1 | tee /dev/stderr)"
URL="$(printf "%s" "$OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1)"
[ -n "$URL" ] || { echo "Deploy finished but no workers.dev URL was printed. Check the output above."; exit 1; }

say "5/7  Private stats password"
[ -f .stats-key ] || node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))' > .stats-key
npx wrangler secret put STATS_KEY < .stats-key >/dev/null
echo "Saved (kept in .stats-key on this Mac only)"

say "6/7  Testing the live server"
sleep 5
node test/smoke.mjs "$URL/mcp"
# clear the test traffic so your stats start clean
npx wrangler d1 execute saas-pricing-mcp --remote --yes --command "DELETE FROM calls; DELETE FROM sessions; DELETE FROM feedback;" >/dev/null

say "7/7  Filling your URL into the listing files"
node -e 'const fs=require("fs");const u=process.argv[1];for(const f of ["server.json","LISTING.md","README.md"]){let t=fs.readFileSync(f,"utf8");t=t.replaceAll("https://saas-pricing-mcp.YOUR_SUBDOMAIN.workers.dev",u);fs.writeFileSync(f,t)}' "$URL"

KEY="$(cat .stats-key)"
cat > DEPLOYED.txt <<EOF
SaaS Pricing MCP is live.

Endpoint (give this to MCP clients):  $URL/mcp
Landing page:                         $URL/
Health check:                         $URL/health
Your private stats:                   $URL/stats?key=$KEY&days=7

Add it to Claude Code:
  claude mcp add --transport http saas-pricing $URL/mcp
EOF
say "Done."
cat DEPLOYED.txt
echo "(Saved to DEPLOYED.txt. Next: LISTING.md for the MCP directories.)"
