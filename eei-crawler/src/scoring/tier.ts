// eei-crawler/src/scoring/tiers.ts

/**
 * Tier scoring engine for EEI.
 *
 * Tier 1, Tier 2, and Tier 3 totals are computed by summing
 * the max-weighted points of each signal that belongs to that tier.
 *
 * This module intentionally does NOT know about the internal scoring details
 * of signals—it only aggregates final results.
 */

import type { SignalResult } from "../models/types";

export interface TierScores {
  tier1: number;
  tier2: number;
  tier3: number;
}

/**
 * Defines which signals belong to each tier.
 * These names must match `SignalResult.name`.
 *
 * Tier 1 signals (already implemented):
 *  - Internal Lattice Integrity
 *  - External Authority Signal
 *  - AI Crawl Fidelity
 *  - Inference Efficiency
 *
 * Tier 2 + Tier 3 will be added as we implement them.
 */
const TIER_MAP: Record<"tier1" | "tier2" | "tier3", string[]> = {
  tier1: [
    "Internal Lattice Integrity",
    "External Authority Signal",
    "AI Crawl Fidelity",
    "Inference Efficiency"
  ],

  // These will be populated once Tier 2 signals ship
  tier2: [
    // "Schema Presence & Validity",
    // "Organization Schema",
    // "Breadcrumb Schema",
    // "Author/Person Schema",
  ],

  // Tier 3 signals (to be added later)
  tier3: [
    // "Title Precision",
    // "Meta Description Integrity",
    // "Canonical Clarity",
    // "Brand & Technical Consistency"
  ]
};

/**
 * Computes tier totals from a list of signal results.
 *
 * @param signals - Array of computed SignalResult
 * @returns { tier1, tier2, tier3 }
 */
export function computeTiers(signals: SignalResult[]): TierScores {
  const sums = {
    tier1: 0,
    tier2: 0,
    tier3: 0
  };

  for (const tier of Object.keys(TIER_MAP) as Array<keyof TierScores>) {
    const names = TIER_MAP[tier];

    for (const name of names) {
      const found = signals.find((s) => s.name === name);
      if (found) {
        sums[tier] += found.score;
      }
    }
  }

  return sums;
}
