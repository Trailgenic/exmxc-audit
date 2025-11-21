// weights.js — Updated per C.1 calibration (Nov 21 2025)

// -----------------------------
// TIER WEIGHTING SYSTEM
// -----------------------------
module.exports = {
  tiers: {
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
  },

  // -----------------------------
  // PARAMETER WEIGHTS
  // These weights determine how much each parameter contributes
  // to its tier's maximum score.
  // (We leave these ints flexible; scoring.js handles normalization)
  // -----------------------------

  parameters: {
    "Title Precision": 3,
    "Meta Description Integrity": 3,
    "Canonical Clarity": 2,
    "Schema Presence & Validity": 8,
    "Organization Schema": 7,
    "Breadcrumb Schema": 5,
    "Author/Person Schema": 5,
    "Social Entity Links": 8,
    "AI Crawl Fidelity": 6,

    // Tier 2
    "Inference Efficiency": 12,
    "Internal Lattice Integrity": 15,
    "External Authority Signal": 12,

    // Tier 3
    "Brand & Technical Consistency": 2
  }
};
