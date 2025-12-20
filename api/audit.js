// /api/audit.js — EEI v6.0
// Capability (ECC) from STATIC only
// Intent inferred from STATIC vs RENDERED delta
// Quadrant derived — no ranking, no judgment

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
import { discoverSurfaces } from "../lib/surface-discovery.js";
import { aggregateSurfaces } from "../lib/surface-aggregator.js";

/* ============================================================
   NETWORK
============================================================ */
const httpsAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 1,
});

/* ============================================================
   CONFIG
============================================================ */
const CRAWL_STATIC_BASE =
  "https://exmxc-crawl-lite-production.up.railway.app";

const CRAWL_RENDER_BASE =
  "https://exmxc-crawl-worker-production.up.railway.app";

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
  if (score === null) return "unknown";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function classifyQuadrant(eccBand, intentPosture) {
  if (eccBand === "high" && intentPosture === "high")
    return "🚀 AI-First Leader";
  if (eccBand === "high" && intentPosture === "low")
    return "🏰 Sovereign / Defensive Power";
  if (eccBand === "medium" && intentPosture === "medium")
    return "⚖️ Cautious Optimizer";
  if (eccBand === "low" && intentPosture === "high")
    return "🌱 Aspirational Challenger";
  return "Unclassified";
}

/* ============================================================
   INTENT DERIVATION (OBSERVED, NOT SCORED)
============================================================ */
function deriveIntent({ staticSurface, renderedSurface }) {
  const signals = [];
  let posture = "low";

  if (!staticSurface) {
    signals.push("No static surface available");
    return { posture, signals, observedFrom: [] };
  }

  const staticWords = staticSurface.wordCount || 0;
  const staticSchema = staticSurface.schemaCount || 0;

  if (staticWords >= 300) {
    signals.push("Static content legible");
  }

  if (staticSchema > 0) {
    signals.push("Schema visible pre-render");
  }

  if (staticWords >= 300 && staticSchema > 0) {
    posture = "high";
  }

  if (renderedSurface) {
    const renderedWords = renderedSurface.wordCount || 0;
    const renderedSchema = renderedSurface.schemaCount || 0;

    if (renderedWords > staticWords) {
      signals.push("Content depth increases after render");
      posture = posture === "high" ? "medium" : posture;
    }

    if (renderedSchema > staticSchema) {
      signals.push("Additional schema appears after render");
      posture = posture === "high" ? "medium" : posture;
    }
  }

  if (posture === "low") {
    signals.push("Limited AI exposure by default");
  }

  return {
    posture,
    signals,
    observedFrom: renderedSurface ? ["static", "rendered"] : ["static"],
  };
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
      return res.status(400).json({ success: false, error: "Missing URL" });
    }

    const normalized = normalizeUrl(input);
    if (!normalized) {
      return res.status(400).json({ success: false, error: "Invalid URL" });
    }

    const host = hostnameOf(normalized);

    /* ========================================================
       STATIC CRAWL (CAPABILITY)
    ======================================================== */
    let staticSurface = null;

    try {
      const staticResp = await axios.post(
        `${CRAWL_STATIC_BASE}/crawl-lite`,
        { url: normalized },
        { timeout: 15000 }
      );

      staticSurface = staticResp.data;
    } catch {}

    /* ========================================================
       RENDERED CRAWL (INTENT ONLY)
    ======================================================== */
    let renderedSurface = null;

    try {
      const discovery = await discoverSurfaces(normalized);
      const surfaceUrls = discovery.surfaces;

      const renderResp = await axios.post(
        `${CRAWL_RENDER_BASE}/crawl`,
        { url: normalized, surfaces: surfaceUrls },
        { timeout: 45000, httpsAgent }
      );

      if (renderResp.data?.success) {
        renderedSurface = renderResp.data.surfaces?.[0] || null;
      }
    } catch {}

    /* ========================================================
       ECC SCORING — STATIC ONLY
    ======================================================== */
    let breakdown = [];
    let eccScore = null;

    if (staticSurface) {
      const $ = cheerio.load(staticSurface.html || "<html></html>");
      const schemaObjects = staticSurface.schemaObjects || [];
      const pageLinks = staticSurface.pageLinks || [];

      breakdown = [
        scoreTitle($, staticSurface),
        scoreMetaDescription($, staticSurface),
        scoreCanonical($, normalized, staticSurface),
        scoreSchemaPresence(schemaObjects),
        scoreOrgSchema(schemaObjects),
        scoreBreadcrumbSchema(schemaObjects),
        scoreAuthorPerson(schemaObjects, $),
        scoreSocialLinks(schemaObjects, pageLinks),
        scoreAICrawlSignals($),
        scoreContentDepth($, staticSurface),
        scoreInternalLinks(pageLinks, host),
        scoreExternalLinks(pageLinks, host),
        scoreFaviconOg($),
      ];

      let totalRaw = 0;
      for (const sig of breakdown) {
        totalRaw += clamp(sig.points || 0, 0, sig.max);
      }

      eccScore = clamp(
        Math.round((totalRaw * 100) / TOTAL_WEIGHT),
        0,
        100
      );
    }

    const eccBand = bandFromScore(eccScore);

    /* ========================================================
       INTENT + QUADRANT
    ======================================================== */
    const intent = deriveIntent({
      staticSurface,
      renderedSurface,
    });

    const quadrant = classifyQuadrant(eccBand, intent.posture);

    /* ========================================================
       AGGREGATES (OPTIONAL, SAFE)
    ======================================================== */
    let entityAggregate = null;
    if (renderedSurface?.surfaces) {
      entityAggregate = aggregateSurfaces({
        surfaces: renderedSurface.surfaces,
      });
    }

    /* ========================================================
       RESPONSE (STABLE CONTRACT)
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

      intent,
      quadrant,

      breakdown: breakdown || [],

      entitySignals: entityAggregate?.entitySignals || null,
      entitySummary: entityAggregate?.entitySummary || null,

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
