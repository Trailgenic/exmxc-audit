// /shared/weights.js — EEI v5.1 (Calibrated 100-Point Rubric — ESM Format)

// ------------------------------------
// TIER 3 — PAGE HYGIENE (10 total)
// ------------------------------------
export const WEIGHTS = {
  title: 3,                 // Title Precision
  metaDescription: 3,       // Meta Description Integrity
  canonical: 2,             // Canonical Clarity
  faviconOg: 2,             // Brand & Technical Consistency

  // ------------------------------------
  // TIER 2 — STRUCTURAL DATA (25 total)
  // ------------------------------------
  schemaPresence: 8,        // Schema Presence & Validity
  orgSchema: 7,             // Organization Schema
  breadcrumbSchema: 5,      // Breadcrumb Schema
  authorPerson: 5,          // Author/Person Schema

  // ------------------------------------
  // SOCIAL SIGNALS (8 total)
  // ------------------------------------
  socialLinks: 8,           // Social Entity Links

  // ------------------------------------
  // TIER 1 — AI COMPREHENSION / GRAPH (45 total)
  // ------------------------------------
  internalLinks: 15,        // Internal Lattice Integrity
  contentDepth: 12,         // Inference Efficiency
  externalLinks: 12,        // External Authority Signal
  aiCrawl: 6                // AI Crawl Fidelity
};

// Total = 100
export const TOTAL_WEIGHT = 100;
