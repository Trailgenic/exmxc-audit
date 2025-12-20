// /shared/eci-mapper.js
// ECI Mapper v1.0
// Translates EEI internals into public-facing Entity Clarity Intelligence
// No crawling. No scoring. No math beyond mapping.

function scoreRange(score) {
  if (score >= 80) return { range: "80+", label: "Strategic trust" };
  if (score >= 70) return { range: "70–79", label: "Strong foundation" };
  if (score >= 60) return { range: "60–69", label: "Developing structure" };
  if (score >= 50) return { range: "50–59", label: "Recognized" };
  if (score >= 40) return { range: "40–49", label: "Weak visibility" };
  return { range: "0–39", label: "Unclear" };
}

/* ============================================================
   Strategic Posture Detection
   ============================================================ */

function determineStrategicPosture({ crawlHealth, aiConfidence, score }) {
  if (!crawlHealth) return "Unformed";

  const flags = crawlHealth.flags || {};
  const blocked =
    flags.isBlocked ||
    crawlHealth.category === "robots-blocked" ||
    crawlHealth.category === "client-error";

  if (blocked) return "Defensive";

  if (score >= 70 && aiConfidence?.level === "high") {
    return "Open Clarity";
  }

  if (score >= 50) {
    return "Selective Clarity";
  }

  return "Unformed";
}

/* ============================================================
   Signal Status Mapping
   ============================================================ */

function signalStatus(points, max) {
  if (!max || max === 0) return "Absent";
  const ratio = points / max;
  if (ratio >= 0.75) return "Strong";
  if (ratio >= 0.4) return "Moderate";
  if (ratio > 0) return "Weak";
  return "Absent";
}

/* ============================================================
   High-Level Clarity Summary
   ============================================================ */

function claritySummary({ score, posture }) {
  if (posture === "Defensive") {
    return {
      overview:
        "This entity has intentionally limited AI interpretability through technical or structural defenses.",
      discoverability: "Low",
      interpretability: "Low",
      narrativeControl: "High",
      defensiveness: "High",
    };
  }

  if (score >= 80) {
    return {
      overview:
        "This entity is clearly interpreted by AI systems and consistently reinforced across structural signals.",
      discoverability: "High",
      interpretability: "High",
      narrativeControl: "High",
      defensiveness: "Low",
    };
  }

  if (score >= 70) {
    return {
      overview:
        "This entity is reliably interpretable by AI systems, though further structural reinforcement could strengthen long-term clarity.",
      discoverability: "High",
      interpretability: "High",
      narrativeControl: "Moderate",
      defensiveness: "Low",
    };
  }

  if (score >= 50) {
    return {
      overview:
        "This entity is recognized by AI systems but lacks sufficient consistency or depth to fully control its narrative.",
      discoverability: "Moderate",
      interpretability: "Moderate",
      narrativeControl: "Low",
      defensiveness: "Low",
    };
  }

  return {
    overview:
      "This entity lacks sufficient structural clarity for AI systems to confidently interpret its identity.",
    discoverability: "Low",
    interpretability: "Low",
    narrativeControl: "Low",
    defensiveness: "Low",
  };
}

/* ============================================================
   Public ECI Builder
   ============================================================ */

export function buildEciPublicOutput({
  entity,
  entityScore,
  breakdown = [],
  crawlHealth = null,
  aiConfidence = null,
  vertical = null,
}) {
  const scoreMeta = scoreRange(entityScore);
  const posture = determineStrategicPosture({
    crawlHealth,
    aiConfidence,
    score: entityScore,
  });

  const claritySignals = breakdown.map((sig, idx) => ({
    id: idx + 1,
    name: sig.key,
    status: signalStatus(sig.points, sig.max),
  }));

  return {
    entity: {
      name: entity?.name || null,
      url: entity?.url,
      hostname: entity?.hostname,
      vertical,
      timestamp: new Date().toISOString(),
    },

    eci: {
      score: entityScore,
      range: scoreMeta.range,
      interpretation: scoreMeta.label,
      confidenceLevel: aiConfidence?.level || "unknown",
      strategicPosture: posture,
    },

    claritySummary: claritySummary({
      score: entityScore,
      posture,
    }),

    claritySignals,

    disclaimer:
      "ECI reflects AI-era entity clarity and interpretability, not business quality, ethics, or performance.",
  };
}
