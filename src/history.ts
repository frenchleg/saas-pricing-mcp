import historyData from "../data/price-history.json";
import type { Product } from "./types";

export interface HistoryEntry {
  date: string;
  kind: "change" | "correction";
  type: "price_change" | "plan_added" | "plan_removed" | "product_added" | "product_removed";
  product: string;
  product_name: string;
  category: string;
  plan?: string;
  field?: "monthly" | "annual_monthly";
  currency?: string;
  old?: unknown;
  new?: unknown;
  pct_change?: number | null;
  note?: string;
}

export const history = historyData as { tracking_since: string; changes: HistoryEntry[] };

export interface HistoryQuery {
  product?: Product;
  category?: string;
  since?: string;
  include_corrections?: boolean;
  limit?: number;
}

/** Newest first. Corrections (fixes to our own data) are excluded unless asked for. */
export function queryHistory(q: HistoryQuery): HistoryEntry[] {
  return history.changes
    .filter((c) => (q.include_corrections ? true : c.kind === "change"))
    .filter((c) => !q.product || c.product === q.product.id)
    .filter((c) => !q.category || c.category === q.category.toLowerCase())
    .filter((c) => !q.since || c.date >= q.since)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, q.limit ?? 100);
}

export function recentChanges(p: Product, n = 5) {
  return queryHistory({ product: p, limit: n });
}
