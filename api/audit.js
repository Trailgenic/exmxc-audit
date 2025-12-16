// /api/audit.js — EEI v5.4
// Entity-level orchestrator — time-budgeted multi-surface, AI-aligned
// Source of truth: exmxc-crawl-worker

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
import { discoverSurfaces } from "../lib/surface-discovery.js";
import { aggregateSurfaces } from "../lib/surface-aggregator.js";

/* ============================================================
   CONFIG
   ============================================================ */

const CRAWL_WORKER_BASE =
  "https://exmxc-crawl-worker-production.up.railway.app";

const WORKER_TIMEOUT_MS = 40000;
const SURFACE_TIME_BUDGET_MS = 35000;

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
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    /* ========================================================
       0) INPUT
       ======================================================== */

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
       1) SURFACE DISCOVERY
       ======================================================== */

    const discovery = await discoverSurfaces(normalized);
    const surfaceUrls = discovery.surfaces || [];

    /* ========================================================
       2) CRAWL WORKER (TIME-BUDGETED)
       ======================================================== */

    const crawlResp = await axios.post(
      `${CRAWL_WORKER_BASE}/crawl`,
      {
        url: normalized,
        surfaces: surfaceUrls,
        timeBudgetMs: SURFACE_TIME_BUDGET_MS,
      },
      { timeout: WORKER_TIMEOUT_MS }
    );

    const crawlData = crawlResp.data;

    if (
      !crawlData?.success ||
      !Array.isArray(crawlData.surfaces) ||
      crawlData.surfaces.length === 0
    ) {
      return res.status(502).json({
        success: false,
        error: "Crawl worker returned no usable surfaces",
        details: crawlData || null,
      });
    }

    /* ========================================================
       3) ENTITY AGGREGATION (PARTIAL OK)
       ======================================================== */

    const entityAggregate = aggregateSurfaces({
      surfaces: crawlData.surfaces.reduce((acc, s) => {
        acc[s.url] = { result: s };
        return acc;
      }, {}),
    });

    /* ========================================================
       4) HOMEPAGE ANCHOR (FIRST RETURNED SURFACE)
       ======================================================== */

    const homepage = crawlData.surfaces[0];

    const {
      html = "",
      title = "",
      description = "",
      canonicalHref: canonical = normalized,
      schemaObjects = [],
      pageLinks = [],
      crawlHealth = null,
    } = homepage;

    const $ = cheerio.load(html || "<html></html>");

    /* ========================================================
       5) ENTITY NAME RESOLUTION
       ======================================================== */

    const entityName =
      schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person")?.name ||
      title.split(" | ")[0] ||
      null;

    /* ========================================================
       6) EEI SIGNAL SCORING (HOMEPAGE-BASED)
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
       7) SCORE AGGREGATION
       ======================================================== */

    let totalRaw = 0;

    for (const sig of results) {
      totalRaw += clamp(sig.points || 0, 0, sig.max);
    }

    const entityScore = clamp(
      Math.round((totalRaw * 100) / TOTAL_WEIGHT),
      0,
      100
    );

    const entityTier = tierFromScore(entityScore);

    /* ========================================================
       8) RESPONSE
       ======================================================== */

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

      entitySignals: entityAggregate.entitySignals,
      entitySummary: entityAggregate.entitySummary,

      surfaceCoverage: {
        discovered: surfaceUrls.length,
        crawled: crawlData.surfaces.length,
        ratio:
          surfaceUrls.length > 0
            ? crawlData.surfaces.length / surfaceUrls.length
            : 1,
      },

      crawlHealth,
      degradedDiscovery: discovery.degraded || false,

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
