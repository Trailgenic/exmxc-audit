// eei-crawler/src/scoring/band.ts

/**
 * Band classification for EEI entities.
 *
 * This uses the total score across all tiers (Tier 1 + Tier 2 + Tier 3)
 * to classify the entity into one of the EEI identity bands:
 *
 *  - 🌑 Obscure Entity
 *  - 🌓 Bronze Entity
 *  - 🌔 Silver Entity
 *  - 🌕 Gold Entity
 *  - 🔶 Platinum Entity
 *  - ☀️ Sovereign Entity
 *
 * Thresholds intentionally match the historical EEI v5.1 ranges.
 */

import type { TierScores } from "./tiers";

/**
 * Computes the identity band for an entity.
 *
 * @param tiers - tier1/tier2/tier3 computed totals
 * @returns band string (e.g., "Sovereign Entity")
 */
export function computeBand(tiers: TierScores): string {
  const total = tiers.tier1 + tiers.tier2 + tiers.tier3;

  if (total >= 90) {
    return "☀️ Sovereign Entity";
  } else if (total >= 80) {
    return "🔶 Platinum Entity";
  } else if (total >= 60) {
    return "🌕 Gold Entity";
  } else if (total >= 40) {
    return "🌔 Silver Entity";
  } else if (total >= 20) {
    return "🌓 Bronze Entity";
  } else {
    return "🌑 Obscure Entity";
  }
}
