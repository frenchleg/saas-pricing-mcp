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

export type YesNo = "yes" | "no" | null;

export interface Compliance {
  checked: string | null;
  trust_url: string | null;
  subprocessors_url: string | null;
  dpa_url: string | null;
  soc2: "type2" | "yes" | "no" | null;
  iso27001: YesNo;
  iso42001: YesNo;
  cyber_essentials: YesNo;
  pci_dss: YesNo;
  gdpr: YesNo;
  hipaa: YesNo;
  eu_data_residency: YesNo;
  uk_data_residency: YesNo;
  ai_training: "no_training" | "no_training_business" | "opt_out" | null;
  notes: string | null;
  evidence: Record<string, string>;
  needs_review?: string[];
}

export interface Product {
  id: string;
  name: string;
  category: string;
  pricing_url: string;
  currency: Currency;
  source: "vendor_page" | "secondary";
  checked: string;
  free_tier: boolean | null;
  free_trial: string | null;
  notes: string | null;
  prices_include_vat?: boolean;
  plans: Plan[];
  compliance?: Compliance;
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
