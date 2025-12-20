// /api/audit.js
// ECI Audit Endpoint — v1.0 LOCKED
// Structural truth. No inference. No silent drops.

import { coreScan } from "./core-scan.js";

/* ============================================================
   CONSTANTS
   ============================================================ */

const SIGNALS = [
  "Title Precision",
  "Meta Description Integrity",
  "Canonical Clarity",
  "Schema Presence & Validity",
  "Organization Schema",
  "Breadcrumb Schema",
  "Author/Person Schema",
  "Social Entity Links",
  "AI Crawl Fidelity",
  "Inference Efficiency",
  "Internal Lattice Integrity",
  "External Authority Signal",
  "Brand & Technical Consistency",
];

const STATUS_SCORE = {
  Strong: 100,
  Moderate: 70,
  Unknown: null
};

/* ============================================================
   HELPERS
   ============================================================ */

function normalizeUrl(input) {
  try {
    return new URL(input).href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function classifyStatus(points, max) {
  if (typeof points !== "number" || typeof max !== "number") return "Unknown";
  const pct = (points / max) * 100;
  if (pct >= 80) return "Strong";
  if (pct >= 40) return "Moderate";
  return "Unknown";
}

function buildEmptySignal(name) {
  return {
    name,
    status: "Unknown"
  };
}

/* ============================================================
   ECI BUILDER (STRICT)
   ============================================================ */

function buildECI(breakdown = []) {
  const signalMap = new Map();

  // Initialize all 13 signals as Unknown
  SIGNALS.forEach(name => {
    signalMap.set(name, buildEmptySignal(name));
  });

  // Overlay observed signals
  breakdown.forEach(sig => {
    if (!sig || !sig.key) return;
    if (!signalMap.has(sig.key)) return;

    signalMap.set(sig.key, {
      name: sig.key,
      status: classifyStatus(sig.points, sig.max)
    });
  });

  const signals = Array.from(signalMap.values());

  // Coverage
  const observed = signals.filter(s => s.status !== "Unknown").length;
  const unknown = signals.length - observed;

  // Score normalization (Unknowns excluded)
  const scored = signals.filter(s => STATUS_SCORE[s.status] !== null);
  const score =
    scored.length === 0
      ? 0
      : Math.round(
          scored.reduce((a, s) => a + STATUS_SCORE[s.status], 0) /
          scored.length
        );

  let interpretation = "Low clarity";
  let posture = "Unformed";
  let range = "—";

  if (score >= 80) {
    interpretation = "Strategic trust";
    posture = "Sovereign";
    range = "80+";
  } else if (score >= 60) {
    interpretation = "Operational clarity";
    posture = "Structured";
    range = "60–79";
  } else if (score >= 40) {
    interpretation = "Partial clarity";
    posture = "Emerging";
    range = "40–59";
  }

  return {
    score,
    range,
    interpretation,
    strategicPosture: posture,
    signalCoverage: {
      observed,
      unknown
    },
    claritySignals: signals
  };
}

/* ============================================================
   API HANDLER
   ============================================================ */

export default async function handler(req, res) {
  try {
    const inputUrl = req.query.url;
    const url = normalizeUrl(inputUrl);

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Invalid URL"
      });
    }

    // Core scan (STATIC ONLY)
    const scan = await coreScan({
      url,
      surfaces: [url],
      probeRendered: false
    });

    const surface = scan.surfaces?.[0] || {};
    const breakdown = surface.breakdown || [];

    const eci = buildECI(breakdown);

    return res.status(200).json({
      success: true,

      eci: {
        entity: {
          name: surface.entityName || surface.title || url,
          url,
          hostname: new URL(url).hostname,
          vertical: null,
          timestamp: new Date().toISOString()
        },
        eci
      },

      eei: {
        url,
        hostname: new URL(url).hostname,
        breakdown,
        crawlHealth: surface.diagnostics || {},
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
