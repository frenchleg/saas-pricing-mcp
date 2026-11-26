// Local (stdio) entry point: runs the same server as the hosted Worker, for MCP clients
// that launch servers as a local process, and for directory build checks (e.g. Glama).
//   npm run build:stdio && node dist/stdio.mjs
// Usage logging is off locally. report_outdated reports are printed to stderr; to send one
// to the maintainer, use the hosted server or open a GitHub issue.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server";

const server = buildServer(
  () => {},
  async (f) => {
    console.error(`[report_outdated] ${JSON.stringify(f)} (not sent: local mode. Please open an issue at https://github.com/frenchleg/saas-pricing-mcp/issues)`);
  },
);
await server.connect(new StdioServerTransport());
console.error("saas-pricing MCP server running on stdio");
