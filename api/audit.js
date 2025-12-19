// /api/audit.js — EEI v5.6
// Static-first EEI audit
// Scoring is ALWAYS based on static crawl
// Rendered crawl is DIAGNOSTIC ONLY (AI obstruction detection)

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
  tierFromScore
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";
import { discoverSurfaces } from "../lib/surface-discovery.js";
import { aggregateSurfaces } from "../lib/surface-aggregator.js";

/* ============================================================
   CONFIG
   ============================================================ */

const CRAWL_WORKER_BASE =
  "https://exmxc-crawl-worker-production.up.railway.app";

const httpsAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 1
});

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
    const input = req.query?.url;
    const includeRenderedProbe = req.query?.probe === "true";

    if (!input) {
      return res.status(400).json({ error: "Missing URL" });
    }

    const normalized = normalizeUrl(input);
    if (!normalized) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const host = hostnameOf(normalized);

    /* ========================================================
       SURFACE DISCOVERY (STATIC)
       ======================================================== */

    const discovery = await discoverSurfaces(normalized);
    const surfaceUrls = discovery.surfaces;

    /* ========================================================
       STATIC MULTI-SURFACE CRAWL (AUTHORITATIVE)
       ======================================================== */

    let crawlData;
    try {
      const crawlResp = await axios.post(
        `${CRAWL_WORKER_BASE}/crawl`,
        { url: normalized, surfaces: surfaceUrls },
        { timeout: 45000, httpsAgent }
      );

      crawlData = crawlResp.data;

      if (!crawlData?.success || !Array.isArray(crawlData.surfaces)) {
        throw new Error("static-crawl-failed");
      }
    } catch {
      return res.status(502).json({
        success: false,
        error: "Static crawl failed"
      });
    }

    /* ========================================================
       AGGREGATE ENTITY SIGNALS
       ======================================================== */

    const entityAggregate = aggregateSurfaces({
      surfaces: crawlData.surfaces
    });

    const homepage = crawlData.surfaces[0] || {};

    const {
      html = "",
      title = "",
      description = "",
      canonicalHref: canonical = normalized,
      schemaObjects = [],
      pageLinks = [],
      diagnostics = {},
      crawlHealth = null
    } = homepage;

    const $ = cheerio.load(html || "<html></html>");

    const entityName =
      schemaObjects.find(o => o["@type"] === "Organization")?.name ||
      schemaObjects.find(o => o["@type"] === "Person")?.name ||
      title.split(" | ")[0] ||
      null;

    /* ========================================================
       EEI SCORING (STATIC ONLY)
       ======================================================== */

    const results = [
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
      scoreFaviconOg($)
    ];

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
       OPTIONAL RENDERED PROBE (DIAGNOSTIC ONLY)
       ======================================================== */

    let aiObstruction = null;

    if (includeRenderedProbe) {
      try {
        const probeResp = await axios.post(
          `${CRAWL_WORKER_BASE}/probe-rendered`,
          { url: normalized },
          { timeout: 20000, httpsAgent }
        );

        const probe = probeResp.data;

        aiObstruction = {
          detected:
            probe?.blocked === true ||
            probe?.wordCount < Math.min(200, diagnostics.wordCount || 9999),
          reason: probe?.reason || null,
          staticWordCount: diagnostics.wordCount || 0,
          renderedWordCount: probe?.wordCount || 0,
          userAgent: probe?.userAgent || null
        };
      } catch {
        aiObstruction = {
          detected: true,
          reason: "rendered-probe-failed"
        };
      }
    }

    /* ========================================================
       RESPONSE
       ======================================================== */

    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: host,
      entityName,
      title,
      canonical,
      description,

      eeiScoringStatus: "scored-static",

      entityScore,
      entityStage: entityTier.stage,
      entityVerb: entityTier.verb,
      entityDescription: entityTier.description,
      entityFocus: entityTier.coreFocus,

      breakdown: results,
      entitySignals: entityAggregate.entitySignals,
      entitySummary: entityAggregate.entitySummary,

      aiObstruction,
      crawlHealth,

      timestamp: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: err.message || String(err)
    });
  }
}
