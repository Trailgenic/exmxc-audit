// /api/audit.js — EEI v6.0
// Static-first ECC scoring + Rendered intent assessment
// Fortress-aligned: Capability ≠ Intent

import axios from "axios";
import https from "https";
import * as cheerio from "cheerio";

import {
  scoreTitle,
  scoreMetaDescription,
  scoreCanonical,
  scoreSchemaPresence,
  scoreOrgSchema,
  scoreBreadcrumbSchema,
  scoreAuthorPerson,
  scoreSocialLinks,
  scoreAICrawlSignals,
  scoreContentDepth,
  scoreInternalLinks,
  scoreExternalLinks,
  scoreFaviconOg,
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";

/* ============================================================
   NETWORK HARDENING
============================================================ */
const httpsAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 1,
});

/* ============================================================
   CONFIG — Railway Crawlers
============================================================ */
const STATIC_CRAWL_BASE =
  "https://exmxc-crawl-lite-production.up.railway.app"; // static truth
const RENDERED_CRAWL_BASE =
  "https://exmxc-crawl-worker-production.up.railway.app"; // intent probe

/* ============================================================
   HELPERS
============================================================ */
function normalizeUrl(input) {
  let url = (input || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function bandFromScore(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {
  const origin = req.headers.origin || "*";

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const input = req.query?.url;
    if (!input) {
      return res.status(400).json({ error: "Missing URL" });
    }

    const normalized = normalizeUrl(input);
    if (!normalized) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const host = hostnameOf(normalized);

    /* ========================================================
       1️⃣ STATIC CRAWL → ECC (Capability)
    ======================================================== */
    let staticResult;

    try {
      const resp = await axios.post(
        `${STATIC_CRAWL_BASE}/crawl-lite`,
        { url: normalized },
        { timeout: 20000 }
      );
      staticResult = resp.data;
    } catch {
      return res.status(502).json({
        success: false,
        error: "Static crawl failed",
      });
    }

    const {
      html = "",
      title = "",
      description = "",
      canonical = "",
      schemaObjects = [],
      pageLinks = [],
      diagnostics = {},
    } = staticResult || {};

    const $ = cheerio.load(html || "<html></html>");

    /* ========================================================
       ECC SCORING (STATIC ONLY)
    ======================================================== */
    const breakdown = [
      scoreTitle($, { title }),
      scoreMetaDescription($, { description }),
      scoreCanonical($, normalized, { canonicalHref: canonical }),
      scoreSchemaPresence(schemaObjects),
      scoreOrgSchema(schemaObjects),
      scoreBreadcrumbSchema(schemaObjects),
      scoreAuthorPerson(schemaObjects, $),
      scoreSocialLinks(schemaObjects, pageLinks),
      scoreAICrawlSignals($),
      scoreContentDepth($, { wordCount: diagnostics.wordCount }),
      scoreInternalLinks(pageLinks, host),
      scoreExternalLinks(pageLinks, host),
      scoreFaviconOg($),
    ];

    let totalRaw = 0;
    for (const sig of breakdown) {
      totalRaw += clamp(sig.points || 0, 0, sig.max);
    }

    const eccScore = clamp(
      Math.round((totalRaw * 100) / TOTAL_WEIGHT),
      0,
      100
    );

    const eccBand = bandFromScore(eccScore);

    /* ========================================================
       2️⃣ RENDERED CRAWL → INTENT (NO SCORING)
    ======================================================== */
    let intentPosture = "low";
    let intentSignals = [];
    let intentObservedFrom = ["static"];

    try {
      const renderedResp = await axios.post(
        `${RENDERED_CRAWL_BASE}/crawl`,
        { url: normalized, surfaces: ["/"] },
        { timeout: 45000, httpsAgent }
      );

      const rendered = renderedResp.data?.surfaces?.[0];

      if (rendered?.schemaObjects?.length > schemaObjects.length) {
        intentPosture = "high";
        intentSignals.push("Additional schema exposed via JS rendering");
      }

      if (rendered?.mode === "rendered") {
        intentObservedFrom.push("rendered");
      }
    } catch {
      intentSignals.push("No rendered surface exposure detected");
    }

    if (intentPosture === "low" && intentSignals.length === 0) {
      intentSignals.push("Limited AI exposure by default");
    }

    /* ========================================================
       3️⃣ QUADRANT (NON-JUDGMENTAL)
    ======================================================== */
    let quadrant = "Unclassified";

    if (eccBand === "high" && intentPosture === "high")
      quadrant = "🚀 AI-First Leader";
    else if (eccBand === "high" && intentPosture === "low")
      quadrant = "🏰 Sovereign / Defensive Power";
    else if (eccBand === "medium" && intentPosture === "medium")
      quadrant = "⚖️ Cautious Optimizer";
    else if (eccBand === "low" && intentPosture === "high")
      quadrant = "🌱 Aspirational Challenger";

    /* ========================================================
       RESPONSE
    ======================================================== */
    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: host,

      ecc: {
        score: eccScore,
        band: eccBand,
        max: 100,
      },

      intent: {
        posture: intentPosture,
        signals: intentSignals,
        observedFrom: intentObservedFrom,
      },

      quadrant,
      breakdown,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
}
