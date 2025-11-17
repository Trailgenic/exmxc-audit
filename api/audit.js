// /api/audit.js — FINAL EEI v5 (Single URL Audit)
// V5 scoring layer on top of V4 crawl + signals

import auditHandler from "./audit-v4.js";  // rename to your actual v4 file
import { tierFromScore } from "../shared/scoring.js";

/* ---------- Helpers ---------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeOrigin(req, res) {
  const origin = req.headers.origin || req.headers.referer;
  let normalized = "*";

  try {
    if (origin && origin !== "null") {
      normalized = new URL(origin).origin;
    }
  } catch {
    normalized = "*";
  }

  res.setHeader("Access-Control-Allow-Origin", normalized);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (normalized !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

/* ---------- V5 Scoring Weights ---------- */

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
  (s, w) => s + w,
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

    /* ----------------------------------------------------
       🔥 UI bypass fix — ensure V4 does NOT block the crawl
       ---------------------------------------------------- */
    req.headers["x-exmxc-key"] = "exmxc-internal";

    /* ----------------------------------------------------
       🔄 Call V4 crawler internally
       ---------------------------------------------------- */
    let v4 = null;

    const fakeReq = {
      query: { url: input },
      headers: { "x-exmxc-key": "exmxc-internal" },
      method: "GET"
    };

    const fakeRes = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        v4 = obj;
        return obj;
      },
      setHeader() {}
    };

    await auditHandler(fakeReq, fakeRes);

    if (!v4 || !v4.success) {
      return res.status(fakeRes.statusCode || 500).json({
        error: "Underlying audit (v4) failed",
        details: v4?.error || "Unknown",
        raw: v4 || null
      });
    }

    /* ----------------------------------------------------
       🧮 Recompute signals under V5 weighting system
       ---------------------------------------------------- */
    const signalsByKey = {};
    for (const sig of v4.signals || []) {
      if (sig?.key) signalsByKey[sig.key] = sig;
    }

    let rawTotal = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

    for (const [key, weight] of Object.entries(V5_SIGNAL_WEIGHTS)) {
      const sig = signalsByKey[key];
      const strength = sig?.max
        ? clamp((sig.points ?? 0) / sig.max, 0, 1)
        : 0;

      const contrib = strength * weight;
      rawTotal += contrib;

      const tier = V5_TIER_MAP[key] || "tier3";
      tierRaw[tier] += contrib;
      tierMax[tier] += weight;
    }

    const scale = 100 / TOTAL_V5_WEIGHT;
    const v5Score = clamp(Math.round(rawTotal * scale), 0, 100);

    const v5TierScores = {
      tier1: {
        label: V5_TIER_LABELS.tier1,
        raw: tierRaw.tier1,
        maxWeight: tierMax.tier1,
        normalized: tierMax.tier1
          ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2))
          : 0
      },
      tier2: {
        label: V5_TIER_LABELS.tier2,
        raw: tierRaw.tier2,
        maxWeight: tierMax.tier2,
        normalized: tierMax.tier2
          ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2))
          : 0
      },
      tier3: {
        label: V5_TIER_LABELS.tier3,
        raw: tierRaw.tier3,
        maxWeight: tierMax.tier3,
        normalized: tierMax.tier3
          ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2))
          : 0
      }
    };

    const v5Tier = tierFromScore(v5Score);

    /* ----------------------------------------------------
       📤 Final EEI v5 response
       ---------------------------------------------------- */
    return res.status(200).json({
      success: true,
      mode: "EEI v5 (parallel)",
      url: v4.url,
      hostname: v4.hostname,
      entityName: v4.entityName || null,

      v5Score,
      v5Stage: v5Tier.stage,
      v5Verb: v5Tier.verb,
      v5Description: v5Tier.description,
      v5Focus: v5Tier.coreFocus,
      v5Tiers: v5TierScores,

      v4Score: v4.entityScore,
      v4Stage: v4.entityStage,
      v4Verb: v4.entityVerb,
      v4Description: v4.entityDescription,
      v4Focus: v4.entityFocus,

      signals: v4.signals,
      schemaMeta: v4.schemaMeta,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("EEI v5 error:", err);
    return res.status(500).json({
      error: "Internal server error (v5)",
      details: err?.message || String(err)
    });
  }
}
