export type Currency = "USD" | "GBP";
export type Unit = "per_user" | "per_channel" | "flat" | "usage" | "custom";
export type Billing = "monthly" | "annual";

export interface Plan {
  name: string;
  monthly: number | null;
  annual_monthly: number | null;
  /** Official UK prices where the vendor publishes them (excl. VAT). */
  gbp_monthly?: number | null;
  gbp_annual_monthly?: number | null;
  unit: Unit;
  note?: string;
  limits: string[];
  features: string[];
  min_seats?: number;
  included_seats?: number;
  max_seats?: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  pricing_url: string;
  currency: Currency;
  source: "vendor_page" | "secondary";
  checked: string;
  free_tier: boolean;
  free_trial: string | null;
  notes: string | null;
  plans: Plan[];
}

export interface Dataset {
  dataset_version: string;
  notes: string;
  products: Product[];
}

export interface Rates {
  /** GBP per 1 USD */
  usd_to_gbp: number;
  date: string;
  source: string;
}

export interface Env {
  DB?: D1Database;
  STATS_KEY?: string;
}
