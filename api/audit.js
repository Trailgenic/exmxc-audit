// /api/audit.js — EEI v5.4.1 (CANONICAL-SAFE, SCALE-STABLE)
// Entity-level orchestrator — multi-surface, AI-comprehension aligned
// Source of truth: exmxc-crawl-worker
// Policy: downgrade on scale constraint, never hard-fail

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
   NETWORK HARDENING (SERVERLESS-SAFE)
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

async function resolveCanonicalUrl(url) {
  try {
    const resp = await axios.get(url, {
      maxRedirects: 5,
      timeout: 15000,
      httpsAgent,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return resp.request?.res?.responseUrl || url;
  } catch {
    return url;
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
    if (!input) return res.status(400).json({ error: "Missing URL" });

    const normalizedInput = normalizeUrl(input);
    if (!normalizedInput)
      return res.status(400).json({ error: "Invalid URL format" });

    // 🔑 CRITICAL FIX: resolve canonical BEFORE crawling
    const normalized = await resolveCanonicalUrl(normalizedInput);
    const host = hostnameOf(normalized);

    /* ========================================================
       1) SURFACE DISCOVERY
       ======================================================== */

    const discovery = await discoverSurfaces(normalized);
    const surfaceUrls = discovery.surfaces;

    /* ========================================================
       2) CRAWL WORKER (HARDENED)
       ======================================================== */

    let crawlData;
    let entityComprehensionMode = "bounded-multi-surface";

    try {
      const crawlResp = await axios.post(
        `${CRAWL_WORKER_BASE}/crawl`,
        { url: normalized, surfaces: surfaceUrls },
        {
          timeout: 45000,
          httpsAgent,
        }
      );

      crawlData = crawlResp.data;

      if (!crawlData?.success || !Array.isArray(crawlData.surfaces)) {
        throw new Error("multi-surface-crawl-failed");
      }
    } catch {
      entityComprehensionMode = "scale-constrained";

      const fallbackResp = await axios.post(
        `${CRAWL_WORKER_BASE}/crawl`,
        { url: normalized, surfaces: [normalized] },
        {
          timeout: 25000,
          httpsAgent,
        }
      );

      crawlData = fallbackResp.data;

      if (!crawlData?.success || !Array.isArray(crawlData.surfaces)) {
        return res.status(502).json({
          success: false,
          error: "Crawl worker failed (fallback)",
          details: crawlData || null,
        });
      }
    }

    /* ========================================================
       3) ENTITY AGGREGATION
       ======================================================== */

    const entityAggregate = aggregateSurfaces({
      surfaces: crawlData.surfaces,
    });

    /* ========================================================
       4) CONTENT ANCHOR
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
       5) ENTITY NAME
       ======================================================== */

    const entityName =
      schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person")?.name ||
      title.split(" | ")[0] ||
      host;

    /* ========================================================
       6) EEI SIGNALS
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

      entityComprehensionMode,
      crawlHealth,
      degradedDiscovery: discovery.degraded,

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
