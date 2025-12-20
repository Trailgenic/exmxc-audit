// /api/audit.js — EEI v6.0
// ECC = STATIC ONLY
// Intent = Rendered delta ONLY
// crawl-lite removed entirely

import * as cheerio from "cheerio";
import { crawlPage } from "./core-scan.js";

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
   HELPERS
============================================================ */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function bandFromScore(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function quadrantFrom(eccBand, intentPosture) {
  if (eccBand === "high" && intentPosture === "high") return "🚀 AI-First Leader";
  if (eccBand === "high" && intentPosture === "low") return "🏰 Sovereign / Defensive Power";
  if (eccBand === "medium" && intentPosture === "medium") return "⚖️ Cautious Optimizer";
  if (eccBand === "low" && intentPosture === "high") return "🌱 Aspirational Challenger";
  return "Unclassified";
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {
  try {
    const input = req.query?.url;
    if (!input) {
      return res.status(400).json({ success: false, error: "Missing URL" });
    }

    const url = input.startsWith("http") ? input : `https://${input}`;

    /* ========================================================
       1️⃣ STATIC CRAWL (ECC SOURCE OF TRUTH)
    ======================================================== */
    const staticResult = await crawlPage({
      url,
      mode: "static",
      multiSurface: false,
    });

    if (!staticResult || staticResult.error) {
      return res.status(502).json({
        success: false,
        error: "Static crawl failed",
        details: staticResult?.error,
      });
    }

    const {
      html = "",
      title = "",
      description = "",
      canonicalHref,
      schemaObjects = [],
      pageLinks = [],
      diagnostics = {},
    } = staticResult;

    const $ = cheerio.load(html || "<html></html>");
    const host = new URL(url).hostname.replace(/^www\./, "");

    /* ========================================================
       2️⃣ ECC SCORING (STATIC ONLY)
    ======================================================== */
    const breakdown = [
      scoreTitle($, staticResult),
      scoreMetaDescription($, staticResult),
      scoreCanonical($, url, staticResult),
      scoreSchemaPresence(schemaObjects),
      scoreOrgSchema(schemaObjects),
      scoreBreadcrumbSchema(schemaObjects),
      scoreAuthorPerson(schemaObjects, $),
      scoreSocialLinks(schemaObjects, pageLinks),
      scoreAICrawlSignals($),
      scoreContentDepth($, staticResult),
      scoreInternalLinks(pageLinks, host),
      scoreExternalLinks(pageLinks, host),
      scoreFaviconOg($),
    ];

    let rawTotal = 0;
    for (const sig of breakdown) {
      rawTotal += clamp(sig.points || 0, 0, sig.max);
    }

    const eccScore = clamp(
      Math.round((rawTotal * 100) / TOTAL_WEIGHT),
      0,
      100
    );

    const eccBand = bandFromScore(eccScore);

    /* ========================================================
       3️⃣ RENDERED CRAWL (INTENT ONLY)
    ======================================================== */
    let intentPosture = "low";
    const intentSignals = [];

    try {
      const rendered = await crawlPage({
        url,
        mode: "rendered",
        multiSurface: false,
      });

      if (rendered?.schemaObjects?.length > schemaObjects.length) {
        intentPosture = "high";
        intentSignals.push("Additional schema exposed via JS rendering");
      }
    } catch {
      // Intent defaults to low if rendered crawl fails
    }

    /* ========================================================
       4️⃣ QUADRANT
    ======================================================== */
    const quadrant = quadrantFrom(eccBand, intentPosture);

    /* ========================================================
       RESPONSE
    ======================================================== */
    return res.status(200).json({
      success: true,
      url,
      hostname: host,

      ecc: {
        score: eccScore,
        band: eccBand,
        max: 100,
      },

      intent: {
        posture: intentPosture,
        signals: intentSignals,
        observedFrom: ["static", "rendered"],
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
