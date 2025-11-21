// weights.js — EEI v5.1 (Aligned with scoring.js)

// Export in ES module format for scoring.js compatibility
export const WEIGHTS = {

  // Tier 1 — Entity comprehension & trust (53)
  title: 3,                    // Title Precision
  metaDescription: 3,          // Meta Description Integrity
  canonical: 2,                // Canonical Clarity
  schemaPresence: 8,           // Schema Presence & Validity
  orgSchema: 7,                // Organization Schema
  breadcrumbSchema: 5,         // Breadcrumb Schema
  authorPerson: 5,             // Author/Person Schema
  socialLinks: 8,              // Social Entity Links
  aiCrawl: 6,                  // AI Crawl Fidelity

  // Tier 2 — Structural data fidelity (25)
  contentDepth: 12,            // Inference Efficiency
  internalLinks: 15,           // Internal Lattice Integrity
  externalLinks: 12,           // External Authority Signal

  // Tier 3 — Page-level hygiene (10)
  faviconOg: 2                 // Brand & Technical Consistency
};

// Tier grouping (optional: kept for audit.js display)
export const TIERS = {
  tier1: {
    label: "Entity comprehension & trust",
    maxWeight: 53,
    keys: [
      "Title Precision",
      "Meta Description Integrity",
      "Canonical Clarity",
      "Schema Presence & Validity",
      "Organization Schema",
      "Breadcrumb Schema",
      "Author/Person Schema",
      "Social Entity Links",
      "AI Crawl Fidelity"
    ]
  },
  tier2: {
    label: "Structural data fidelity",
    maxWeight: 25,
    keys: [
      "Inference Efficiency",
      "Internal Lattice Integrity",
      "External Authority Signal"
    ]
  },
  tier3: {
    label: "Page-level hygiene",
    maxWeight: 10,
    keys: [
      "Brand & Technical Consistency"
    ]
  }
};
