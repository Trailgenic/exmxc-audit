// /api/audit.js — ECI + EEI Unified Audit (Fortress-Safe)
// Static-first. No phantom imports. Raw JSON preserved.

import { coreScan } from "./core-scan.js";

/* ============================================================
   ECI SCORING — STRATEGIC (INTENT-AWARE, NON-JUDGMENTAL)
   ============================================================ */

function computeECI(scan) {
  const surfaces = Array.isArray(scan.surfaces) ? scan.surfaces : [];
  const primary = surfaces[0] || {};
  const d = primary.diagnostics || {};

  const schemaCount = d.schemaCount || 0;
  const wordCount = d.wordCount || 0;
  const linkCount = d.linkCount || 0;

  // ---- Score composition (intentionally conservative)
  let score = 0;

  // Structural clarity
  if (schemaCount >= 5) score += 35;
  else score += schemaCount * 5;

  // Narrative depth
  if (wordCount >= 1200) score += 30;
  else if (wordCount >= 600) score += 20;
  else if (wordCount >= 300) score += 10;

  // Lattice presence (not quality judgement)
  if (linkCount >= 50) score += 20;
  else if (linkCount >= 10) score += 10;

  score = Math.min(100, Math.round(score));

  // ---- Strategic posture (IMPORTANT: not moralized)
  let posture = "Unformed";
  if (score >= 80) posture = "Sovereign";
  else if (score >= 60) posture = "Structured";
  else if (score >= 40) posture = "Selective";
  else posture = "Defensive";

  return {
    entity: {
      name: primary.title || "Unknown Entity",
      url: scan.url,
      hostname: new URL(scan.url).hostname,
      vertical: null,
      timestamp: new Date().toISOString()
    },
    eci: {
      score,
      range:
        score >= 80 ? "80+" :
        score >= 60 ? "60–79" :
        score >= 40 ? "40–59" :
        "<40",
      interpretation:
        score >= 80 ? "Strategic trust" :
        score >= 60 ? "Operational clarity" :
        score >= 40 ? "Selective legibility" :
        "Intentional opacity",
      confidenceLevel: "internal",
      strategicPosture: posture
    },
    claritySummary: {
      overview:
        score >= 80
          ? "Entity is consistently interpretable across AI systems."
          : score >= 60
          ? "Entity is legible but not fully reinforced."
          : score >= 40
          ? "Entity reveals partial structure while limiting exposure."
          : "Entity limits machine interpretation by design.",
      discoverability:
        score >= 60 ? "High" : score >= 40 ? "Moderate" : "Low",
      interpretability:
        score >= 60 ? "High" : score >= 40 ? "Moderate" : "Low",
      narrativeControl:
        score >= 80 ? "High" : score >= 60 ? "Moderate" : "Low",
      defensiveness:
        score < 40 ? "High" : score < 60 ? "Moderate" : "Low"
    },
    disclaimer:
      "ECI reflects AI-era entity clarity and strategic posture, not business quality, ethics, or performance."
  };
}

/* ============================================================
   API HANDLER
   ============================================================ */

export default async function handler(req, res) {
  try {
    const url = req.query?.url;
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing ?url parameter"
      });
    }

    // ---- Core entity scan (STATIC ONLY)
    const scan = await coreScan({
      url,
      surfaces: [url],
      probeRendered: false
    });

    // ---- Compute ECI
    const eci = computeECI(scan);

    return res.status(200).json({
      success: true,

      // 🔑 Strategic output (external + internal)
      eci,

      // 🔬 Raw scan preserved for internal dashboard debugging
      raw: scan
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Audit failed"
    });
  }
}
