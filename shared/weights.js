// /shared/weights.js — EEI v5.1 (C.1 Calibrated Weights, 88-Point Universe — ESM Format)

export const WEIGHTS = {
  // ------------------------------------
  // Tier 1 — Entity comprehension & trust (53)
  // ------------------------------------
  title: 3,                    // Title Precision
  metaDescription: 3,          // Meta Description Integrity
  canonical: 2,                // Canonical Clarity
  schemaPresence: 8,           // Schema Presence & Validity
  orgSchema: 7,                // Organization Schema
  breadcrumbSchema: 5,         // Breadcrumb Schema
  authorPerson: 5,             // Author/Person Schema
  socialLinks: 8,              // Social Entity Links
  aiCrawl: 6,                  // AI Crawl Fidelity

  // ------------------------------------
  // Tier 2 — Structural data fidelity (25)
  // ------------------------------------
  contentDepth: 12,            // Inference Efficiency
  internalLinks: 15,           // Internal Lattice Integrity
  externalLinks: 12,           // External Authority Signal

  // ------------------------------------
  // Tier 3 — Page-level hygiene (10)
  // ------------------------------------
  faviconOg: 2                 // Brand & Technical Consistency
};

// Total = 88
export const TOTAL_WEIGHT = 88;
