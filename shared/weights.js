// /shared/weights.js — EEI v2 (AI Comprehension–Weighted Model)

export const WEIGHTS = {
  /* ========== TIER 3 — PAGE HYGIENE (10 pts) ========== */
  title: 3,                // Title Precision
  metaDescription: 3,      // Meta Description Integrity
  canonical: 2,            // Canonical Clarity
  faviconOg: 2,            // Brand & Technical Consistency

  /* ========== TIER 2 — STRUCTURAL DATA (30 pts) ========== */
  schemaPresence: 10,      // Schema Presence & Validity
  orgSchema: 8,            // Organization Schema
  breadcrumbSchema: 7,     // Breadcrumb Schema
  authorPerson: 5,         // Author/Person Schema

  /* ========== TIER 1 — AI COMPREHENSION / GRAPH (60 pts) ========== */
  internalLinks: 20,       // Internal Lattice Integrity
  contentDepth: 15,        // Inference Efficiency
  externalLinks: 15,       // External Authority Signal
  aiCrawl: 10,             // AI Crawl Fidelity

  /* ========== SOCIAL (NEUTRAL CARRYOVER—STAYS 5) ========== */
  // We preserve Social Links at 5 because:
  // - Copilot, Google AI, GPT all check social graph
  // - But it's not a core comprehension driver
  socialLinks: 5           // Social Entity Links (5 pts — sits between tiers)
};
