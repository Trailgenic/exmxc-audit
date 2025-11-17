// V5.1 — Entity Engineering™ Weights

export const WEIGHTS = {
  // --- Tier 3 (Page-level hygiene)
  title: 3,
  meta: 3,
  canonical: 3, // up from 2
  brandConsistency: 3, // up from 2

  // --- Tier 2 (Structural Schema Fidelity)
  schemaPresence: 15, // up from 10
  orgSchema: 12,      // up from 8
  breadcrumb: 10,     // up from 7
  author: 8,          // up from 5

  // --- Tier 1 (Entity Comprehension + Trust)
  social: 5,
  aiCrawl: 8,          // down from 10
  inference: 15,
  internalLinks: 15,   // down from 20
  externalLinks: 10,   // down from 15
};

export const TOTAL_WEIGHT =
  Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
