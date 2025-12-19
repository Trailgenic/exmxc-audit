// /api/audit.js — EEI v5.6
// Sovereign dual-crawler orchestration (lite → heavy)
// Lite = discovery only
// Heavy = authoritative EEI scoring

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
  tierFromScore,
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";
import { discoverSurfaces } from "../lib/surface-discovery.js";
import { aggregateSurfaces } from "../lib/surface-aggregator.js";

/* ============================================================
   NETWORK HARDENING
   ============================================================ */

const httpsAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 1,
});

/* ============================================================
   CONFIG
   ============================================================ */

const CRAWL_WORKER_BASE =
  "https://exmxc-crawl-worker-production.up.railway.app";

const CRAWL_LITE_BASE =
  "https://exmxc-crawl-lite-production.up.railway.app";

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
    const mode = req.query?.mode || "auto"; // auto | lite | heavy

    if (!input) {
      return res.status(400).json({ success: false, error: "Missing URL" });
    }

    const normalized = normalizeUrl(input);
    if (!normalized) {
      return res.status(400).json({ success: false, error: "Invalid URL" });
    }

    const host = hostnameOf(normalized);

    let crawlData = null;
    let entityComprehensionMode = "heavy";

    /* ========================================================
       LITE MODE — DISCOVERY ONLY (NO SCORING)
       ======================================================== */

    if (mode === "lite" || mode === "auto") {
      try {
        const liteResp = await axios.post(
          `${CRAWL_LITE_BASE}/crawl-lite`,
          { url: normalized },
          { timeout: 15000 }
        );

        const lite = liteResp.data;

        crawlData = {
          success: true,
          surfaces: [
            {
              html: "", // ⛔ intentionally empty
              title: lite.title || "",
              description: lite.description || "",
              canonicalHref: lite.canonical || normalized,
              schemaObjects: lite.schemaObjects || [],
              pageLinks: [],
              crawlHealth: { mode: "lite" },
            },
          ],
        };

        entityComprehensionMode = "lite";

      } catch (err) {
        if (mode === "lite") {
          return res.status(502).json({
            success: false,
            error: "Lite crawl failed",
          });
        }
      }
    }

    /* ========================================================
       HEAVY MODE — AUTHORITATIVE CRAWL
       ======================================================== */

    if (!crawlData) {
      entityComprehensionMode = "heavy";

      const discovery = await discoverSurfaces(normalized);
      const surfaceUrls = discovery.surfaces;

      try {
        const crawlResp = await axios.post(
          `${CRAWL_WORKER_BASE}/crawl`,
          { url: normalized, surfaces: surfaceUrls },
          { timeout: 45000, httpsAgent }
        );

        crawlData = crawlResp.data;

        if (!crawlData?.success || !Array.isArray(crawlData.surfaces)) {
          throw new Error("crawl-failed");
        }
      } catch {
        return res.status(502).json({
          success: false,
          error: "Crawl worker failed",
        });
      }
    }

    /* ========================================================
       AGGREGATION
       ======================================================== */

    const entityAggregate = aggregateSurfaces({
      surfaces: crawlData.surfaces,
    });

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

    const entityName =
      schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person")?.name ||
      title.split(" | ")[0] ||
      null;

    /* ========================================================
       EEI SCORING — HEAVY ONLY
       ======================================================== */

    const isLiteOnly = entityComprehensionMode === "lite";

    let results = [];
    let entityScore = null;
    let entityTier = null;

    if (!isLiteOnly) {
      results = [
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

      let totalRaw = 0;
      for (const sig of results) {
        totalRaw += clamp(sig.points || 0, 0, sig.max);
      }

      entityScore = clamp(
        Math.round((totalRaw * 100) / TOTAL_WEIGHT),
        0,
        100
      );

      entityTier = tierFromScore(entityScore);
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

      eeiScoringStatus: isLiteOnly ? "unscored-lite" : "scored-heavy",

      entityScore,
      entityStage: entityTier?.stage || null,
      entityVerb: entityTier?.verb || null,
      entityDescription: entityTier?.description || null,
      entityFocus: entityTier?.coreFocus || null,

      breakdown: isLiteOnly ? [] : results,
      entitySignals: entityAggregate.entitySignals,
      entitySummary: entityAggregate.entitySummary,

      entityComprehensionMode,
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
