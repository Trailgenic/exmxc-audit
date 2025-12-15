// /api/audit.js — EEI v5.3
// Entity-level orchestrator — multi-surface, AI-comprehension aligned
// Source of truth: exmxc-crawl-worker
// No crawling logic here. No Playwright. No guessing.

import axios from "axios";
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
  tierFromScore,
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";

import discoverSurfaces from "../lib/surface-discovery.js";
import { aggregateSurfaces } from "../lib/surface-aggregator.js";

/* ============================================================
   CONFIG
   ============================================================ */

const CRAWL_WORKER_BASE =
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

/* ============================================================
   TIER MAPPING
   ============================================================ */

const SIGNAL_TIER = {
  "Title Precision": "tier3",
  "Meta Description Integrity": "tier3",
  "Canonical Clarity": "tier3",
  "Brand & Technical Consistency": "tier3",

  "Schema Presence & Validity": "tier2",
  "Organization Schema": "tier2",
  "Breadcrumb Schema": "tier2",
  "Author/Person Schema": "tier2",

  "Social Entity Links": "tier1",
  "Internal Lattice Integrity": "tier1",
  "External Authority Signal": "tier1",
  "AI Crawl Fidelity": "tier1",
  "Inference Efficiency": "tier1",
};

const TIER_LABELS = {
  tier1: "Entity comprehension & trust",
  tier2: "Structural data fidelity",
  tier3: "Page-level hygiene",
};

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
    "Content-Type, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    /* ---------- Input ---------- */
    const input = req.query?.url;
    if (!input) return res.status(400).json({ error: "Missing URL" });

    const normalized = normalizeUrl(input);
    if (!normalized)
      return res.status(400).json({ error: "Invalid URL format" });

    const host = hostnameOf(normalized);

    /* ========================================================
       1) SURFACE DISCOVERY (ENTITY-FIRST)
       ======================================================== */

    const surfaces = discoverSurfaces(normalized);
    // example output: ["/", "/about", "/science", "/blog", "/podcast"]

    /* ========================================================
       2) CALL CRAWL WORKER (MULTI-SURFACE)
       ======================================================== */

    const crawlResp = await axios.post(
      `${CRAWL_WORKER_BASE}/crawl`,
      { url: normalized, surfaces },
      { timeout: 45000 }
    );

    const crawlData = crawlResp.data;

    if (!crawlData?.success || !Array.isArray(crawlData.surfaces)) {
      return res.status(502).json({
        success: false,
        error: "Crawl worker failed",
        details: crawlData || null,
      });
    }

    /* ========================================================
       3) AGGREGATE SURFACES → ENTITY SNAPSHOT
       ======================================================== */

    const entitySnapshot = aggregateSurfaces({
      baseUrl: normalized,
      hostname: host,
      surfaces: crawlData.surfaces,
    });

    /*
      entitySnapshot = {
        html,
        title,
        description,
        canonical,
        schemaObjects,
        pageLinks,
        crawlHealth,
        surfaceCoverage
      }
    */

    const {
      html,
      title,
      description,
      canonical,
      schemaObjects,
      pageLinks,
      crawlHealth,
      surfaceCoverage,
    } = entitySnapshot;

    const $ = cheerio.load(html || "<html></html>");

    /* ========================================================
       4) ENTITY NAME RESOLUTION
       ======================================================== */

    const entityName =
      schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person")?.name ||
      (title?.includes(" | ")
        ? title.split(" | ")[0]
        : title?.split(" - ")[0]) ||
      null;

    /* ========================================================
       5) RUN 13 EEI SIGNALS (ENTITY-WIDE)
       ======================================================== */

    const results = [
      scoreTitle($),
      scoreMetaDescription($),
      scoreCanonical($, normalized),
      scoreSchemaPresence(schemaObjects),
      scoreOrgSchema(schemaObjects),
      scoreBreadcrumbSchema(schemaObjects),
      scoreAuthorPerson(schemaObjects, $),
      scoreSocialLinks(schemaObjects, pageLinks),
      scoreAICrawlSignals($),
      scoreContentDepth($),
      scoreInternalLinks(pageLinks, host),
      scoreExternalLinks(pageLinks, host),
      scoreFaviconOg($),
    ];

    /* ========================================================
       6) SCORE AGGREGATION
       ======================================================== */

    let totalRaw = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

    for (const sig of results) {
      const safe = clamp(sig.points || 0, 0, sig.max);
      const tier = SIGNAL_TIER[sig.key] || "tier3";
      totalRaw += safe;
      tierRaw[tier] += safe;
      tierMax[tier] += sig.max;
    }

    const entityScore = clamp(
      Math.round((totalRaw * 100) / TOTAL_WEIGHT),
      0,
      100
    );

    const entityTier = tierFromScore(entityScore);

    /* ========================================================
       7) RESPONSE
       ======================================================== */

    const scoringBars = results.map((r) => ({
      key: r.key,
      points: r.points,
      max: r.max,
      percent: r.max ? Math.round((r.points / r.max) * 100) : 0,
      notes: r.notes,
    }));

    const tierScores = {
      tier1: {
        label: TIER_LABELS.tier1,
        normalized:
          tierMax.tier1 > 0
            ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2))
            : 0,
      },
      tier2: {
        label: TIER_LABELS.tier2,
        normalized:
          tierMax.tier2 > 0
            ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2))
            : 0,
      },
      tier3: {
        label: TIER_LABELS.tier3,
        normalized:
          tierMax.tier3 > 0
            ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2))
            : 0,
      },
    };

    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: host,
      entityName,
      title,
      canonical,
      description,

      entityScore,
      entityStage: entityTier.stage,
      entityVerb: entityTier.verb,
      entityDescription: entityTier.description,
      entityFocus: entityTier.coreFocus,

      breakdown: results,
      scoringBars,
      tierScores,

      surfacesAnalyzed: surfaceCoverage,
      crawlHealth,

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
