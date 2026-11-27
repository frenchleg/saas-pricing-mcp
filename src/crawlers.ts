// Guess whether an MCP client is a directory, registry, uptime monitor or other crawler rather than
// a real app or agent, from the name it sends in `initialize`. Most connections to a newly listed
// server come from these, so /stats splits them out to show real usage.
// This is a name-based guess only: a crawler can call itself anything.
export const CRAWLER_PATTERN =
  /(probe|prober|crawl|spider|(?<!chat)bot\b|health|check|monitor|catalog|registry|index|observer|verif|scan|uptime|glama|mcpbeat|inspector|ping|validator|watch)/i;

export function looksLikeCrawler(name: string | null | undefined): boolean {
  return CRAWLER_PATTERN.test(name ?? "");
}
