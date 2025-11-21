// /api/audit.js — EEI v5.1 (Aligned to Crawl v2.3 + Diagnostics + CrawlHealth)
import { crawlPage } from "./core-scan.js";
import * as cheerio from "cheerio";
import {
  scoreTitle,
  scoreMetaDescription,
  scoreCanonical,
  scoreFaviconOg,
  scoreSchemaPresence,
  scoreOrgSchema,
  scoreBreadcrumbSchema,
  scoreAuthorPerson,
  scoreSocialLinks,
  scoreInternalLinks,
  scoreExternalLinks,
  scoreAICrawlSignals,
  scoreContentDepth,
  tierFromScore
} from "../shared/scoring.js";
import { TOTAL_WEIGHT } from "../shared/weights.js";

/* ============================================================
   0. CRAWL HEALTH INTERPRETER (Phase B)
   ============================================================ */

function computeCrawlHealth(diagnostics = {}) {
  const type = diagnostics.errorType || null;
  const retry = diagnostics.retryAttempts || 0;

  if (!type) {
    return {
      status: "healthy",
      penalty: 0,
      multiplier: 1,
      notes: "No crawl issues detected"
    };
  }

  if (type === "timeout") {
    return {
      status: "degraded",
      penalty: 4,
      multiplier: 0.94,
      notes: "Timeout during crawl"
    };
  }

  if (type === "network-error") {
    return {
      status: "degraded",
      penalty: 6,
      multiplier: 0.92,
      notes: "Network or connection issue"
    };
  }

  if (type === "blocked" || type === "blocked-rate-limit") {
    return {
      status: "blocked",
      penalty: 12,
      multiplier: 0.85,
      notes: "Crawl blocked or rate-limited"
    };
  }

  return {
    status: "unknown",
    penalty: 8,
    multiplier: 0.90,
    notes: "Unknown crawl degradation"
  };
}

/* ============================================================
   1. API HANDLER
   ============================================================ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing ?url parameter"
      });
    }

    /* ----------------------------------------------
       2. Run Crawl
       ---------------------------------------------- */
    const crawl = await crawlPage({ url, mode: "rendered" });

    /* ----------------------------------------------
       3. Load DOM (Cheerio)
       ---------------------------------------------- */
    const $ = cheerio.load(crawl.html || "");

    /* ----------------------------------------------
       4. Run Scoring Functions
       ---------------------------------------------- */
    const originHost = new URL(crawl.canonicalHref || url).hostname.replace(/^www\./, "");

    const results = [
      scoreTitle($),
      scoreMetaDescription($),
      scoreCanonical($, crawl.canonicalHref),
      scoreFaviconOg($),

      scoreSchemaPresence(crawl.schemaObjects),
      scoreOrgSchema(crawl.schemaObjects),
      scoreBreadcrumbSchema(crawl.schemaObjects),
      scoreAuthorPerson(crawl.schemaObjects, $),

      scoreSocialLinks(crawl.schemaObjects, crawl.pageLinks),
      scoreInternalLinks(crawl.pageLinks, originHost),
      scoreExternalLinks(crawl.pageLinks, originHost),
      scoreAICrawlSignals($),

      scoreContentDepth($)
    ];

    const baseScore = results.reduce((sum, r) => sum + (r.points || 0), 0);
    const normalizedScore = Math.min(baseScore, TOTAL_WEIGHT);

    /* ----------------------------------------------
       5. Compute CrawlHealth (Phase B.3)
       ---------------------------------------------- */
    const crawlHealth = computeCrawlHealth(crawl.diagnostics);

    // apply multiplier (safest + most stable path)
    const finalScore = Math.round(normalizedScore * crawlHealth.multiplier);

    const { stage, verb, description, coreFocus } = tierFromScore(finalScore);

    /* ----------------------------------------------
       6. Build Final Response
       ---------------------------------------------- */

    const payload = {
      success: true,
      url,
      entityScore: finalScore,
      entityStage: stage,
      entityVerb: verb,
      entityDescription: description,
      entityCoreFocus: coreFocus,

      /* ---- RAW SCORE COMPONENTS ---- */
      baseScore,
      totalWeight: TOTAL_WEIGHT,
      breakdown: results,

      /* ---- CRAWL RESULTS ---- */
      crawlType: crawl._type,
      rendered: crawl._type === "rendered",
      canonicalHref: crawl.canonicalHref,
      latestISO: crawl.latestISO,

      /* ---- NEW (Phase B) ---- */
      crawlHealth,        // passthrough + scoring effect
      diagnostics: crawl.diagnostics, // full diagnostics passthrough

      /* ---- RAW CRAWL ---- */
      schemaObjects: crawl.schemaObjects || [],
      pageLinks: crawl.pageLinks || [],
      ldTexts: crawl.ldTexts || [],

      timestamp: new Date().toISOString()
    };

    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Audit failed"
    });
  }
}
