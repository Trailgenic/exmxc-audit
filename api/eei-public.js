// /api/eei-public.js
// EEI Public Proxy — UX-safe, narrative-first, moat-protecting

import axios from "axios";

/* ============================================================
   CONFIG (FIXED)
   ============================================================ */

// Explicit, safe origin resolution
const INTERNAL_ORIGIN = process.env.EEI_INTERNAL_ORIGIN
  ? process.env.EEI_INTERNAL_ORIGIN
  : process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : null;

const INTERNAL_TIMEOUT_MS = 25000;

/* ============================================================
   HELPERS
   ============================================================ */

function normalizeUrl(input) {
  let url = (input || "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ============================================================
   STRUCTURAL PROFILE
   ============================================================ */

function buildStructuralProfile({ entityScore, tierScores }) {
  const t1 = tierScores?.tier1?.normalized ?? 0;
  const t2 = tierScores?.tier2?.normalized ?? 0;
  const t3 = tierScores?.tier3?.normalized ?? 0;

  let headline = "Developing structural clarity";
  let summary =
    "This entity shows early AI visibility but lacks sufficient structural reinforcement.";
  let risk = "medium";

  if (t1 >= 75 && t3 >= 70 && t2 < 50) {
    headline = "Strong present authority, weak structural durability";
    summary =
      "AI systems currently recognize and trust this entity, but internal structure and crawl integrity are insufficient.";
    risk = "elevated";
  } else if (t2 >= 70 && (t1 < 60 || t3 < 60)) {
    headline = "Solid structural foundation, under-leveraged authority";
    summary =
      "This entity has strong internal structure and data fidelity, but surface signals limit AI elevation.";
    risk = "contained";
  } else if (t1 >= 75 && t2 >= 70 && t3 >= 70) {
    headline = "Durable, trusted AI-facing entity";
    summary =
      "This entity demonstrates strong authority, structure, and surface hygiene.";
    risk = "low";
  } else if (entityScore < 60) {
    headline = "Fragile AI interpretation";
    summary =
      "AI systems may interpret this entity inconsistently.";
    risk = "high";
  }

  return { headline, summary, risk };
}

/* ============================================================
   MAIN HANDLER
   ============================================================ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (!INTERNAL_ORIGIN) {
    return res.status(500).json({
      success: false,
      error: "INTERNAL_ORIGIN not configured",
    });
  }

  try {
    const input = req.query?.url;
    const normalized = normalizeUrl(input);

    if (!normalized) {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing URL",
      });
    }

    const auditUrl = `${INTERNAL_ORIGIN}/api/audit?url=${encodeURIComponent(
      normalized
    )}`;

    const auditResp = await axios.get(auditUrl, {
      timeout: INTERNAL_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "User-Agent": "exmxc-eei-public-proxy/1.0",
      },
      validateStatus: (s) => s >= 200 && s < 500,
    });

    if (!auditResp.data || typeof auditResp.data !== "object") {
      throw new Error("Audit endpoint did not return JSON");
    }

    const audit = auditResp.data;

    if (!audit.success) {
      return res.status(500).json({
        success: false,
        error: audit.error || "EEI audit failed",
      });
    }

    const entityScore = clamp(audit.entityScore ?? 0, 0, 100);
    const tierScores = audit.tierScores || {};

    const structuralProfile = buildStructuralProfile({
      entityScore,
      tierScores,
    });

    const ch = audit.crawlHealth || {};

    return res.status(200).json({
      success: true,

      entity: {
        name: audit.entityName || audit.hostname || "Unknown entity",
        score: entityScore,
        stage: audit.entityStage || null,
        verb: audit.entityVerb || null,
        description: audit.entityDescription || null,
        focus: audit.entityFocus || null,
      },

      tiers: {
        tier1: { score: tierScores?.tier1?.normalized ?? 0 },
        tier2: { score: tierScores?.tier2?.normalized ?? 0 },
        tier3: { score: tierScores?.tier3?.normalized ?? 0 },
      },

      crawlHealth: {
        score: typeof ch.score === "number" ? ch.score : null,
        category: ch.category || null,
        note:
          Array.isArray(ch.notes) && ch.notes.length
            ? ch.notes[0]
            : "Internal crawl diagnostics available.",
      },

      structuralProfile,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Public EEI proxy error",
      details: err.message,
    });
  }
}
