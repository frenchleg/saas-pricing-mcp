// Shared helpers for the page checker and the update proposer.
export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&pound;|&#163;/g, "£")
    .replace(/&dollar;|&#36;/g, "$")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function priceTokens(text) {
  const re = /(?:US\$|\$|£|€)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:USD|GBP|EUR)\b/g;
  return [...new Set((text.match(re) ?? []).map((t) => t.replace(/\s+/g, "")))].sort();
}
