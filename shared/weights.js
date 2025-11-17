// /shared/weights.js — EEI v5.1 (Calibrated 100-Point Rubric)

export const WEIGHTS = {
  /* ============================
     TIER 3 — PAGE HYGIENE (10)
     ============================ */
  title: 3,                // Title Precision
  metaDescription: 3,      // Meta Description Integrity
  canonical: 2,            // Canonical Clarity
  faviconOg: 2,            // Brand & Technical Consistency

  /* ============================
     TIER 2 — STRUCTURAL DATA (25)
     ============================ */
  schemaPresence: 8,       // Schema Presence & Validity (reduced from 10)
  orgSchema: 7,            // Organization Schema
  breadcrumbSchema: 5,     // Breadcrumb Schema (reduced from 7)
  authorPerson: 5,         // Author/Person Schema

  /* ============================
     SOCIAL SIGNAL (Now boosted slightly to 8)
     ============================ */
  socialLinks: 8,          // Social Entity Links (+3 to align w/ real-world authority)

  /* ============================
     TIER 1 — AI COMPREHENSION / GRAPH (45)
     ============================ */
  internalLinks: 15,       // Internal Lattice Integrity (reduced from 20)
  contentDepth: 12,        // Inference Efficiency (reduced from 15)
  externalLinks: 12,       // External Authority Signal (reduced from 15)
  aiCrawl: 6               // AI Crawl Fidelity (reduced from 10)
};

/* Total = 100 exactly (no normalization needed) */
export const TOTAL_WEIGHT = 100;
