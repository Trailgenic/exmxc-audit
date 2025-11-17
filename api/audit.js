// /api/audit.js — EEI v5 Parallel Scoring (Tiered + Reweighted)

import auditHandler from "./audit-v4.js";   // ✅ FIXED — no recursion
import { tierFromScore } from "../shared/scoring.js";

/* ---------- Helpers ---------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeOrigin(req, res) {
  const origin = req.headers.origin || req.headers.referer;
  let normalizedOrigin = "*";
  if (origin && origin !== "null") {
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      normalizedOrigin = "*";
    }
  }
  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (normalizedOrigin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

/* ---------- V5 Weight Map (Tiered) ---------- */
/**
 * We reuse the 13 existing signals, but recombine them into
 * Tier 1 / Tier 2 / Tier 3 with new weights.
 *
 * Sum of weights = 105, then normalized to 100.
 */
const V5_SIGNAL_WEIGHTS = {
  "Title Precision": 3,
  "Meta Description Integrity": 3,
  "Canonical Clarity": 2,
  "Brand & Technical Consistency": 2,

  "Schema Presence & Validity": 10,
  "Organization Schema": 8,
  "Breadcrumb Schema": 7,
  "Author/Person Schema": 5,

  "Social Entity Links": 5,
  "Internal Lattice Integrity": 20,
  "External Authority Signal": 15,
  "AI Crawl Fidelity": 10,
  "Inference Efficiency": 15
};

const V5_TIER_MAP = {
  "Title Precision": "tier3",
  "Meta Description Integrity": "tier3",
  "Canonical Clarity": "tier3",
  "Brand & Technical Consistency": "tier3",

  "Schema Presence & Validity": "tier2",
  "Organization Schema": "tier2",
  "Breadcrumb Schema": "tier2",
  "Author/Person Schema": "tier2",

  "Social Entity Links": "tier1",
  "Internal Lattice Integrity": "tier1",
  "External Authority Signal": "tier1",
  "AI Crawl Fidelity": "tier1",
  "Inference Efficiency": "tier1"
};

const V5_TIER_LABELS = {
  tier1: "Entity comprehension & trust",
  tier2: "Structural data fidelity",
  tier3: "Page-level hygiene"
};

const TOTAL_V5_WEIGHT = Object.values(V5_SIGNAL_WEIGHTS).reduce(
  (sum, w) => sum + w,
  0
);

/* ================================
   MAIN HANDLER (EEI v5)
   ================================ */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    normalizeOrigin(req, res);
    return res.status(200).end();
  }

  normalizeOrigin(req, res);
  res.setHeader("Content-Type", "application/json");

  try {
    const input = req.query?.url;
    if (!input || typeof input !== "string" || !input.trim()) {
      return res.status(400).json({ error: "Missing URL" });
    }

    // 🔁 Call V4 audit internally (crawl + scoring)
    let baseOutput = null;

    const fakeReq = {
      query: { url: input },
      headers: {
        origin: "http://localhost",
        "x-exmxc-key": "exmxc-internal"
      },
      method: "GET"
    };

    const fakeRes = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        baseOutput = obj;
        return obj;
      },
      setHeader() {}
    };

    await auditHandler(fakeReq, fakeRes);

    if (!baseOutput || !baseOutput.success) {
      return res.status(fakeRes.statusCode || 500).json({
        error: "Underlying audit failed (v4)",
        details: baseOutput?.error || "Unknown error",
        base: baseOutput || null
      });
    }

    const signals = Array.isArray(baseOutput.signals)
      ? baseOutput.signals
      : [];
    const byKey = {};
    for (const sig of signals) {
      if (sig?.key) byKey[sig.key] = sig;
    }

    /* ---------- V5 scoring ---------- */
    let rawTotal = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierWeightTotals = { tier1: 0, tier2: 0, tier3: 0 };

    for (const [key, weight] of Object.entries(V5_SIGNAL_WEIGHTS)) {
      const sig = byKey[key];
      if (!sig || !sig.max) continue;

      const normalized = clamp((sig.points ?? 0) / sig.max, 0, 1);
      const contribution = normalized * weight;

      rawTotal += contribution;
      const tier = V5_TIER_MAP[key];
      tierRaw[tier] += contribution;
      tierWeightTotals[tier] += weight;
    }

    const scaleFactor = 100 / TOTAL_V5_WEIGHT;
    const v5Score = clamp(Math.round(rawTotal * scaleFactor), 0, 100);

    const v5TierScores = {
      tier1: {
        label: V5_TIER_LABELS.tier1,
        raw: tierRaw.tier1,
        maxWeight: tierWeightTotals.tier1,
        normalized: Number(
          ((tierRaw.tier1 / tierWeightTotals.tier1) * 100).toFixed(2)
        )
      },
      tier2: {
        label: V5_TIER_LABELS.tier2,
        raw: tierRaw.tier2,
        maxWeight: tierWeightTotals.tier2,
        normalized: Number(
          ((tierRaw.tier2 / tierWeightTotals.tier2) * 100).toFixed(2)
        )
      },
      tier3: {
        label: V5_TIER_LABELS.tier3,
        raw: tierRaw.tier3,
        maxWeight: tierWeightTotals.tier3,
        normalized: Number(
          ((tierRaw.tier3 / tierWeightTotals.tier3) * 100).toFixed(2)
        )
      }
    };

    const v5Tier = tierFromScore(v5Score);

    return res.status(200).json({
      success: true,
      mode: "EEI v5 (parallel)",
      url: baseOutput.url,
      hostname: baseOutput.hostname,
      entityName: baseOutput.entityName,

      v5Score,
      v5Stage: v5Tier.stage,
      v5Verb: v5Tier.verb,
      v5Description: v5Tier.description,
      v5Focus: v5Tier.coreFocus,
      v5Tiers: v5TierScores,

      v4Score: baseOutput.entityScore,
      v4Stage: baseOutput.entityStage,
      v4Verb: baseOutput.entityVerb,
      v4Description: baseOutput.entityDescription,
      v4Focus: baseOutput.entityFocus,

      signals: baseOutput.signals,
      schemaMeta: baseOutput.schemaMeta,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("EEI v5 Audit Error:", err);
    return res.status(500).json({
      error: "Internal server error (v5)",
      details: err?.message || String(err)
    });
  }
}
