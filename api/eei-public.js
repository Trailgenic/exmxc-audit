// /api/eei-public.js
// EEI Public Proxy — UX-safe, narrative-first, moat-protecting
// Calls /api/audit server-to-server and returns a sanitized payload
// Designed for public Webflow / static consumption

import axios from "axios";

/* ============================================================
   CONFIG
   ============================================================ */

// IMPORTANT:
// Use the same origin when deployed on Vercel.
// If running locally, set EEI_INTERNAL_ORIGIN=http://localhost:3000
const INTERNAL_ORIGIN =
  process.env.EEI_INTERNAL_ORIGIN ||
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "";

// Timeout tuned for crawl + score but safe for proxy
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
   STRUCTURAL POWER PROFILE (Narrative Engine)
   ============================================================ */

function buildStructuralProfile({ entityScore, tierScores }) {
  const t1 = tierScores?.tier1?.normalized ?? 0;
  const t2 = tierScores?.tier2?.normalized ?? 0;
  const t3 = tierScores?.tier3?.normalized ?? 0;

  // Default
  let headline = "Developing structural clarity";
  let summary =
    "This entity shows early AI visibility but lacks sufficient structural reinforcement.";
  let risk = "medium";

  // Strong present, weak future (your Rolling Stone case)
  if (t1 >= 75 && t3 >= 70 && t2 < 50) {
    headline = "Strong present authority, weak structural durability";
    summary =
      "AI systems currently recognize and trust this entity, but internal structure and crawl integrity are insufficient. Without reinforcement, AI confidence may deteriorate over time.";
    risk = "elevated";
  }
  // Strong structure, weak surface
  else if (t2 >= 70 && (t1 < 60 || t3 < 60)) {
    headline = "Solid structural foundation, under-leveraged authority";
    summary =
      "This entity has strong internal structure and data fidelity, but surface signals limit current AI elevation.";
    risk = "contained";
  }
  // Across-the-board strength
  else if (t1 >= 75 && t2 >= 70 && t3 >= 70) {
    headline = "Durable, trusted AI-facing entity";
    summary =
      "This entity demonstrates strong authority, structural integrity, and surface hygiene. AI systems can reliably interpret and elevate it.";
    risk = "low";
  }
  // Fragile overall
  else if (entityScore < 60) {
    headline = "Fragile AI interpretation";
    summary =
      "AI systems may see this entity inconsistently and lack confidence in its structure or authority.";
    risk = "high";
  }

  return { headline, summary, risk };
}

/* ============================================================
   MAIN HANDLER
   ============================================================ */

export default async function handler(req, res) {
  /* ---------- CORS ---------- */
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    /* ---------- Input ---------- */
    const input = req.query?.url;
    const normalized = normalizeUrl(input);

    if (!normalized) {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing URL",
      });
    }

    /* ---------- Call internal EEI engine ---------- */
    const auditUrl = `${INTERNAL_ORIGIN}/api/audit?url=${encodeURIComponent(
      normalized
    )}`;

    const auditResp = await axios.get(auditUrl, {
      timeout: INTERNAL_TIMEOUT_MS,
      headers: {
        "User-Agent": "exmxc-eei-public-proxy/1.0",
        Accept: "application/json",
      },
      validateStatus: (s) => s >= 200 && s < 500,
    });

    const audit = auditResp.data;

    if (!audit || !audit.success) {
      return res.status(500).json({
        success: false,
        error: audit?.error || "EEI audit failed",
      });
    }

    /* ---------- Extract + sanitize ---------- */

    const entityScore = clamp(audit.entityScore ?? 0, 0, 100);
    const tierScores = audit.tierScores || {};

    const structuralProfile = buildStructuralProfile({
      entityScore,
      tierScores,
    });

    /* ---------- Crawl health (summarized) ---------- */
    const ch = audit.crawlHealth || {};
    const crawlHealth = {
      score: typeof ch.score === "number" ? ch.score : null,
      category: ch.category || null,
      note:
        Array.isArray(ch.notes) && ch.notes.length > 0
          ? ch.notes[0]
          : "Crawl diagnostics available internally.",
    };

    /* ---------- Public payload ---------- */
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
        tier1: {
          label: tierScores?.tier1?.label,
          score: tierScores?.tier1?.normalized ?? 0,
        },
        tier2: {
          label: tierScores?.tier2?.label,
          score: tierScores?.tier2?.normalized ?? 0,
        },
        tier3: {
          label: tierScores?.tier3?.label,
          score: tierScores?.tier3?.normalized ?? 0,
        },
      },

      crawlHealth,

      structuralProfile,

      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Public EEI proxy error",
      details: err.message || String(err),
    });
  }
}
