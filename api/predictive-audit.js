// /api/predictive-audit.js — Predictive-v7 + Upgrade Leverage Targets
// Vertical-level structural risk intelligence based on:
// Strategic Posture + ECC capability banding + resilience / exposure indexes

import path from "path";

/* ================================
   Helpers
================================ */
function pct(n, d) {
  return d === 0 ? 0 : Number(((n / d) * 100).toFixed(1));
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function capabilityBand(ecc = 0) {
  if (ecc >= 80) return "high";
  if (ecc >= 60) return "medium";
  return "low";
}

function normalizePosture(state = "") {
  const s = state.toLowerCase();
  if (s === "open") return "open";
  if (s === "defensive") return "defensive";
  if (s === "blocked") return "blocked";
  return "unknown";
}

function matrixKey(posture, band) {
  return `${posture}-${band}`;
}

/* ================================
   ANALYSIS CORE
================================ */
function analyze(results = []) {
  const clean = results.filter(r => r && r.url);

  const total = clean.length;
  if (!total) {
    return {
      total,
      counts: { open: 0, defensive: 0, blocked: 0, unknown: 0 },
      caps: { high: 0, medium: 0, low: 0 },
      matrix: {},
      avgECC: 0,
      anchors: [],
      risks: [],
      breakpoints: [],
      entities: []
    };
  }

  let sumECC = 0;

  const counts = { open: 0, defensive: 0, blocked: 0, unknown: 0 };
  const caps = { high: 0, medium: 0, low: 0 };

  const matrix = {
    "open-high": 0,
    "open-medium": 0,
    "open-low": 0,
    "defensive-high": 0,
    "defensive-medium": 0,
    "defensive-low": 0,
    "blocked-low": 0,
    "blocked-medium": 0,
    "blocked-high": 0
  };

  const anchors = [];
  const risks = [];
  const breakpoints = [];
  const entities = [];

  for (const r of clean) {
    const posture = normalizePosture(r.state);
    const ecc = Number(r.ecc ?? r?._raw?.ecc?.score ?? 0);
    const band = capabilityBand(ecc);

    sumECC += ecc;

    counts[posture] = (counts[posture] ?? 0) + 1;
    caps[band]++;

    const key = matrixKey(posture, band);
    if (matrix[key] !== undefined) matrix[key]++;

    const record = { url: r.url, ecc, posture, band };
    entities.push(record);

    if (posture === "open" && band === "high") anchors.push(record);
    if (posture === "defensive" && band === "low") risks.push(record);
    if (posture === "blocked" && band !== "low") breakpoints.push(record);
  }

  const avgECC = Number((sumECC / total).toFixed(2));

  return {
    total,
    counts,
    caps,
    matrix,
    avgECC,
    anchors,
    risks,
    breakpoints,
    entities
  };
}

/* ================================
   INDEX CALCULATION (v7)
================================ */

function computeResilience(stats) {
  const { total, matrix } = stats;
  if (!total) return 0;

  const anchors =
    (matrix["open-high"] ?? 0) * 1.0 +
    (matrix["open-medium"] ?? 0) * 0.5;

  const penalties =
    (matrix["blocked-low"] ?? 0) * 1.0 +
    (matrix["blocked-medium"] ?? 0) * 0.6;

  const raw = (anchors - penalties) / total;
  return clamp01(raw);
}

function computeExposure(stats) {
  const { total, matrix } = stats;
  if (!total) return 0;

  const risky =
    (matrix["defensive-low"] ?? 0) * 1.0 +
    (matrix["blocked-low"] ?? 0) * 1.0 +
    (matrix["blocked-medium"] ?? 0) * 0.6;

  return clamp01(risky / total);
}

function computeFragility(stats) {
  const { total, matrix } = stats;
  if (!total) return 0;

  const belt =
    (matrix["defensive-low"] ?? 0) +
    (matrix["open-low"] ?? 0);

  return clamp01(belt / total);
}

function deriveBands({ resilience, exposure, fragility }) {
  let riskBand = "Stable";
  if (exposure >= 0.45 || fragility >= 0.35) riskBand = "Fragile";
  else if (exposure >= 0.25 || fragility >= 0.22) riskBand = "Watch";

  let trajectory = "Flat";

  if (resilience >= 0.6 && exposure <= 0.2) {
    trajectory = "Strengthening";
  } else if (resilience <= 0.35 && exposure >= 0.35) {
    trajectory = "Weakening";
  } else if (fragility >= 0.4) {
    trajectory = "Drifting Toward Failure";
  }

  return { riskBand, trajectory };
}

/* ================================
   UPGRADE LEVERAGE TARGETS (NEW)
================================ */
function computeUpgradeLeverage(stats) {
  const candidates = stats.entities.map(e => {
    let leverage = 0;
    let rationale = [];

    // Defensive → Open = systemic posture lift
    if (e.posture === "defensive") {
      leverage += 2;
      rationale.push("Posture upgrade to Open materially increases crawl trust");
    }

    // Medium → High when close to threshold
    if (e.band === "medium" && e.ecc >= 75) {
      leverage += 2;
      rationale.push("Near-high capability — small upgrade compounds impact");
    }

    // Remove fragility concentration
    if (e.posture === "defensive" && e.band === "low") {
      leverage += 1;
      rationale.push("Reduces fragility concentration in defensive-low belt");
    }

    return {
      ...e,
      leverage,
      rationale: rationale.join(". ")
    };
  });

  const highROI = candidates
    .filter(x => x.leverage >= 3)
    .sort((a, b) => b.ecc - a.ecc)
    .slice(0, 8);

  const quickWins = candidates
    .filter(x => x.leverage === 2)
    .sort((a, b) => b.ecc - a.ecc)
    .slice(0, 8);

  return { highROI, quickWins };
}

/* ================================
   ANALYST NOTES
================================ */
function generateNotes(stats, indexes) {
  const notes = [];
  const { matrix, avgECC } = stats;
  const { resilience, exposure, fragility } = indexes;

  if ((matrix["open-high"] ?? 0) >= 5) {
    notes.push("Strong anchor cluster: multiple Open-High entities stabilize the vertical.");
  }

  if (matrix["defensive-medium"] >= matrix["open-medium"]) {
    notes.push("Large Defensive-Medium belt: meaningful upside if upgrades move posture to Open.");
  }

  if (exposure >= 0.35) {
    notes.push("High structural exposure: Defensive-Low and Blocked nodes create fragility concentration.");
  }

  if (fragility >= 0.3) {
    notes.push("Significant fragility belt: many entities are one step from failure.");
  }

  if (avgECC >= 75) {
    notes.push("Average ECC is strong — focus shifts from lift to moat-building.");
  } else if (avgECC >= 60) {
    notes.push("ECC is mid-tier — schema + graph depth improvements can move the pack upward.");
  } else {
    notes.push("Low ECC baseline — vertical is open territory for a disciplined, schema-first operator.");
  }

  return notes;
}

/* ================================
   API HANDLER — Predictive-v7
================================ */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const { dataset = "unknown", results } = body || {};

  if (!Array.isArray(results) || !results.length) {
    return res.status(400).json({
      success: false,
      error: "Predictive-v7 requires a non-empty `results` array (use output from /api/batch-run)."
    });
  }

  const stats = analyze(results);

  const resilience = computeResilience(stats);
  const exposure   = computeExposure(stats);
  const fragility  = computeFragility(stats);

  const bands = deriveBands({ resilience, exposure, fragility });

  const leverage = computeUpgradeLeverage(stats);   // ⬅️ NEW
  const notes = generateNotes(stats, { resilience, exposure, fragility });

  return res.status(200).json({
    success: true,
    mode: "predictive-v7",
    dataset,

    stats: {
      totalSites: stats.total,
      avgECC: stats.avgECC,
      postureCounts: stats.counts,
      capabilityCounts: stats.caps,
      matrix: stats.matrix,

      anchors: stats.anchors.slice(0, 10),
      risks: stats.risks.slice(0, 10),
      breakpoints: stats.breakpoints.slice(0, 10)
    },

    indexes: {
      resilience,
      exposure,
      fragility,
      ...bands
    },

    leverage,   // ⬅️ NEW OUTPUT
    notes
  });
}
