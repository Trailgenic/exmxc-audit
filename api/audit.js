// /api/audit.js
// ECI (Entity Clarity Index) — Assembly + Interpretation Layer
// EEI remains diagnostic truth. ECI expresses strategic meaning.
// NO crawling logic here. NO scoring math here.

import { coreScan } from "./core-scan.js";
import { runScoring } from "../shared/scoring-runner.js"; 
// ^ assumed existing wrapper that produces EEI output

/* ============================================================
   POSTURE TAXONOMY (LOCKED)
   ============================================================ */

const POSTURES = {
  OPEN: "Open Signal Strategy",
  OPTIMIZED: "Optimized Visibility Strategy",
  DEFENSIVE: "Defensive Control Strategy",
  OPAQUE: "Opaque / Minimal Exposure Strategy"
};

/* ============================================================
   SCORE → RANGE / INTERPRETATION
   ============================================================ */

function scoreRange(score) {
  if (score >= 80) return "80+";
  if (score >= 70) return "70–79";
  if (score >= 60) return "60–69";
  if (score >= 50) return "50–59";
  if (score >= 40) return "40–49";
  return "0–39";
}

function scoreInterpretation(score) {
  if (score >= 80) return "Strategic trust";
  if (score >= 70) return "Strong foundation";
  if (score >= 60) return "Developing structure";
  if (score >= 50) return "Recognized but inconsistent";
  if (score >= 40) return "Weak visibility";
  return "Unclear";
}

/* ============================================================
   DEFENSIVENESS + POSTURE INFERENCE
   IMPORTANT: NOT SCORE-BASED
   ============================================================ */

function inferStrategicPosture({ eei, renderedDiagnostics }) {
  const crawl = renderedDiagnostics || {};
  const score = eei.entityScore;

  const hasNoIndex =
    typeof crawl.robots === "string" &&
    crawl.robots.toLowerCase().includes("noindex");

  const renderedBlocked = crawl.blocked === true;

  // Explicit AI blocking or heavy JS obfuscation
  if (hasNoIndex || renderedBlocked) {
    if (score >= 70) return POSTURES.DEFENSIVE;
    return POSTURES.OPAQUE;
  }

  // No blocking, strong clarity
  if (score >= 75) return POSTURES.OPEN;

  // Mid scores with no blocking
  if (score >= 55) return POSTURES.OPTIMIZED;

  return POSTURES.OPAQUE;
}

function defensivenessLevel(posture) {
  switch (posture) {
    case POSTURES.DEFENSIVE:
      return "High";
    case POSTURES.OPAQUE:
      return "High";
    case POSTURES.OPTIMIZED:
      return "Moderate";
    case POSTURES.OPEN:
    default:
      return "Low";
  }
}

/* ============================================================
   CLARITY SIGNAL NORMALIZATION (13 SIGNALS)
   ============================================================ */

function normalizeSignals(breakdown = []) {
  return breakdown.map((sig, idx) => {
    let status = "Absent";
    const pct = sig.max ? sig.points / sig.max : 0;

    if (pct >= 0.8) status = "Strong";
    else if (pct >= 0.4) status = "Moderate";

    return {
      id: idx + 1,
      name: sig.key,
      status
    };
  });
}

/* ============================================================
   CLARITY SUMMARY
   ============================================================ */

function buildClaritySummary(score, posture) {
  return {
    overview:
      score >= 80
        ? "This entity is clearly interpreted by AI systems and consistently reinforced across structural signals."
        : score >= 60
        ? "This entity is interpretable but structural clarity may degrade under stricter AI models."
        : "This entity lacks sufficient clarity for reliable AI interpretation.",
    discoverability: score >= 75 ? "High" : score >= 55 ? "Moderate" : "Low",
    interpretability: score >= 75 ? "High" : score >= 55 ? "Moderate" : "Low",
    narrativeControl:
      posture === POSTURES.OPEN || posture === POSTURES.OPTIMIZED
        ? "High"
        : "Low",
    defensiveness: defensivenessLevel(posture)
  };
}

/* ============================================================
   MAIN HANDLER
   ============================================================ */

export default async function handler(req, res) {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ success: false, error: "Missing URL" });
    }

    /* ----------------------------
       1. Crawl (static authoritative)
    ----------------------------- */
    const scan = await coreScan({
      url,
      surfaces: [url],
      probeRendered: true // diagnostic only
    });

    /* ----------------------------
       2. EEI Scoring (unchanged)
    ----------------------------- */
    const eei = await runScoring(scan);

    /* ----------------------------
       3. ECI Assembly
    ----------------------------- */
    const score = eei.entityScore;
    const posture = inferStrategicPosture({
      eei,
      renderedDiagnostics: scan.renderedDiagnostics
    });

    const eci = {
      entity: {
        name: eei.entityName || eei.hostname,
        url: eei.url,
        hostname: eei.hostname,
        vertical: null,
        timestamp: new Date().toISOString()
      },

      eci: {
        score,
        range: scoreRange(score),
        interpretation: scoreInterpretation(score),
        confidenceLevel: "unknown", // reserved for future model variance
        strategicPosture: posture
      },

      claritySummary: buildClaritySummary(score, posture),

      claritySignals: normalizeSignals(eei.breakdown),

      disclaimer:
        "ECI reflects AI-era entity clarity and interpretability, not business quality, ethics, or performance."
    };

    /* ----------------------------
       4. Response
    ----------------------------- */
    return res.json({
      success: true,
      eci,
      eei, // FULL diagnostic truth (internal use)
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("ECI audit error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "ECI audit failed"
    });
  }
}
