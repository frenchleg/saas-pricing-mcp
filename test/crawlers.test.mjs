// Unit test for the crawler guess used by /stats: node test/crawlers.test.mjs
// Names below are real clients seen in production stats.
import assert from "node:assert/strict";
import { looksLikeCrawler } from "../src/crawlers.ts";

const crawlers = [
  "posthog-mcp-registry-probe", "glimind-probe", "mcpbeat", "alalanet-prober", "glama", "talaria-catalog",
  "ainet-probe", "verifymcp-probe", "mcptry-health-check", "toolquorum-observer", "protogrid-probe", "probe",
  "mcpwatch", "factanker-probe", "every-mcp-probe",
];
const apps = ["claude-code", "coda-agent-runtime", "HANS", "rmcp", "cursor-vscode", "(unknown)", "chatbot-ui"];

for (const name of crawlers) assert.equal(looksLikeCrawler(name), true, `${name} should look like a crawler`);
for (const name of apps) assert.equal(looksLikeCrawler(name), false, `${name} should look like an app`);
assert.equal(looksLikeCrawler(null), false, "missing name is not a crawler");
console.log(`crawlers.test: ${crawlers.length + apps.length + 1} checks passed`);
