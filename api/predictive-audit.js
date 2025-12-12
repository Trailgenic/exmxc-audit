// /api/predictive-audit.js
// Predictive EEI — vertical-level stress test (Option B Hybrid)
// Uses latest batch results passed in from the client + /data/predictive-model.json

import fs from "fs/promises";
import path from "path";

const MODEL_PATH = path.join(process.cwd(), "data", "predictive-model.json");

/**
 * Safely load predictive-model.json, with sane defaults if it's empty/minimal.
 */
async function loadModel() {
  try {
    const raw = await fs.readFile(MODEL_PATH, "utf8");
    const json = raw.trim() ? JSON.parse(raw) : {};
    const weights = json.weights || {};

    return {
      version: json.version || "v1",
      weights: {
        avgEEI: weights.avgEEI ?? 0.5,
        sovereignShare: weights.sovereignShare ?? 0.2,
        structuredShare: weights.structuredShare ?? 0.15,
        visibleShare: weights.visibleShare ?? 0.1,
        emergentShare: weights.emergentShare ?? 0.05
      },
      thresholds: {
        highRisk: json.thresholds?.highRisk ?? 45,
        mediumRisk: json.thresholds?.mediumRisk ?? 60,
        strongVertical: json.thresholds?.strongVertical ?? 75,
        stableVertical: json.thresholds?.stableVertical ?? 55
      }
    };
  } catch (err) {
    // If the file is missing or invalid, fall back to defaults
    console.error("[predictive-audit] Failed to load predictive-model.json:", err);
    return {
      version: "v1-default",
      weights: {
        avgEEI: 0.5,
        sovereignShare: 0.2,
        structuredShare: 0.15,
        visibleShare: 0.1,
        emergentShare: 0.05
      },
      thresholds: {
        highRisk: 45,
        mediumRisk: 60,
        strongVertical: 75,
        stableVertical: 55
      }
    };
  }
}

/**
 * Compute basic stats from a vertical's EEI results.
 * `results` is the array of per-site audits from batch-run.
 */
function analyzeVertical(results = []) {
  const clean = results.filter(
    (r) => r && typeof r.entityScore === "number" && !Number.isNaN(r.entityScore)
  );

  const total = clean.length;
  if (!total) {
    return {
      totalSites: 0,
      avgEEI: 0,
      stageCounts: {
        sovereign: 0,
        structured: 0,
        visible: 0,
        emergent: 0,
        unknown: 0
      },
      shares: {
        sovereign: 0,
        structured: 0,
        visible: 0,
        emergent: 0
      },
      top5: [],
      bottom5: []
    };
  }

  let sum = 0;
  const stageCounts = {
    sovereign: 0,
    structured: 0,
    visible: 0,
    emergent: 0,
    unknown: 0
  };

  for (const r of clean) {
    const s = r.entityScore ?? 0;
    sum += s;

    const stage = (r.entityStage || "").toLowerCase();
    if (stage.includes("sovereign")) stageCounts.sovereign++;
    else if (stage.includes("structured")) stageCounts.structured++;
    else if (stage.includes("visible")) stageCounts.visible++;
    else if (stage.includes("emergent")) stageCounts.emergent++;
    else stageCounts.unknown++;
  }

  const avgEEI = sum / total;

  const shares = {
    sovereign: stageCounts.sovereign / total,
    structured: stageCounts.structured / total,
    visible: stageCounts.visible / total,
    emergent: stageCounts.emergent / total
  };

  const sorted = [...clean].sort(
    (a, b) => (b.entityScore ?? 0) - (a.entityScore ?? 0)
  );

  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5).reverse();

  return {
    totalSites: total,
    avgEEI,
    stageCounts,
    shares,
    top5,
    bottom5
  };
}

/**
 * Turn stats + model weights into a predictive index and narrative.
 */
function computePrediction(stats, model) {
  const { avgEEI, shares } = stats;
  const { weights, thresholds } = model;

  // Normalize avg EEI to 0–1
  const normAvg = avgEEI / 100;

  // Lower visible/emergent share is good, so we invert those.
  const visiblePenalty = 1 - shares.visible;
  const emergentPenalty = 1 - shares.emergent;

  let rawScore =
    weights.avgEEI * normAvg +
    weights.sovereignShare * shares.sovereign +
    weights.structuredShare * shares.structured +
    weights.visibleShare * visiblePenalty +
    weights.emergentShare * emergentPenalty;

  // Clamp and scale to 0–100
  rawScore = Math.max(0, Math.min(1, rawScore));
  const predictiveScore = Math.round(rawScore * 100);

  // Risk band based mainly on avgEEI + emergent share
  let riskBand = "Low Drift Risk";
  if (avgEEI < thresholds.highRisk || shares.emergent >= 0.35) {
    riskBand = "High Drift Risk";
  } else if (avgEEI < thresholds.mediumRisk || shares.emergent >= 0.2) {
    riskBand = "Moderate Drift Risk";
  }

  // Trajectory tag based on predictiveScore
  let trajectory = "Stable";
  if (predictiveScore >= thresholds.strongVertical) {
    trajectory = "Upward — Authority Consolidating";
  } else if (predictiveScore >= thresholds.stableVertical) {
    trajectory = "Stable — Entity Cohesive, Room to Scale";
  } else {
    trajectory = "Volatile — Fragmented or Under-signaled";
  }

  const notes = [];

  if (shares.sovereign >= 0.4) {
    notes.push("Strong concentration of Sovereign entities in this vertical.");
  } else if (shares.structured >= 0.4) {
    notes.push("Structured entities dominate; small upgrades can tip many into Sovereign.");
  } else if (shares.emergent >= 0.3) {
    notes.push("Many brands are still Emergent; large upside but high drift risk.");
  }

  if (avgEEI >= 70) {
    notes.push("Average EEI is already high; focus on moat and drift prevention.");
  } else if (avgEEI >= 55) {
    notes.push("Average EEI is mid-tier; upgrades in schema and graph depth will move the whole pack.");
  } else {
    notes.push("Average EEI is low; this vertical is wide open for a disciplined schema-first player.");
  }

  return {
    predictiveScore,
    riskBand,
    trajectory,
    notes
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  let body;
  try {
    // Next can pass body as object or string depending on config
    body =
      typeof req.body === "string" && req.body.trim()
        ? JSON.parse(req.body)
        : req.body || {};
  } catch (err) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid JSON body for predictive audit." });
  }

  const { dataset = "unknown-vertical", results } = body || {};

  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({
      success: false,
      error:
        "Predictive audit requires a non-empty `results` array (use the output from /api/batch-run)."
    });
  }

  const model = await loadModel();
  const stats = analyzeVertical(results);
  const prediction = computePrediction(stats, model);

  return res.status(200).json({
    success: true,
    mode: "predictive",
    dataset,
    modelVersion: model.version,
    stats: {
      totalSites: stats.totalSites,
      avgEEI: Number(stats.avgEEI.toFixed(2)),
      stageCounts: stats.stageCounts,
      shares: {
        sovereign: Number((stats.shares.sovereign * 100).toFixed(1)),
        structured: Number((stats.shares.structured * 100).toFixed(1)),
        visible: Number((stats.shares.visible * 100).toFixed(1)),
        emergent: Number((stats.shares.emergent * 100).toFixed(1))
      },
      top5: stats.top5,
      bottom5: stats.bottom5
    },
    predictive: prediction
  });
}
