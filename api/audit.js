// /api/audit.js — EEI v5.2 (Railway-Orchestrated Crawl)
// Orchestrator only — delegates crawling to exmxc-crawl-worker

import * as cheerio from "cheerio";
import axios from "axios";

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

/* ================================
   CONFIG
   ================================ */

const CRAWL_WORKER_BASE =
  "https://exmxc-crawl-worker-production.up.railway.app";

/* ================================
   HELPERS
   ================================ */

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

/* ================================
   TIER MAPPING
   ================================ */

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

/* ================================
   MAIN HANDLER
   ================================ */

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

    /* ---------- Call Railway Crawl Worker ---------- */
    const crawlResp = await axios.post(
      `${CRAWL_WORKER_BASE}/crawl`,
      {
        url: normalized,
        surfaces: ["/"],
      },
      { timeout: 30000 }
    );

    const crawlSurface = crawlResp.data?.surfaces?.[0];
    if (!crawlSurface || crawlSurface.status >= 400) {
      return res.status(502).json({
        success: false,
        error: "Crawl worker failed",
        details: crawlResp.data || null,
      });
    }

    const html = crawlSurface.html || crawlSurface.content || "";
    const crawlHealth = crawlSurface.crawlHealth || null;

    const $ = cheerio.load(html);

    /* ---------- Extract Fields ---------- */
    const title = ($("title").text() || "").trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    const canonicalHref =
      $('link[rel="canonical"]').attr("href") ||
      normalized.replace(/\/$/, "");

    /* ---------- JSON-LD ---------- */
    const schemaObjects = $('script[type="application/ld+json"]')
      .map((_, el) => {
        try {
          return JSON.parse($(el).text());
        } catch {
          return null;
        }
      })
      .get()
      .filter(Boolean);

    /* ---------- Entity Name ---------- */
    const entityName =
      schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person")?.name ||
      (title.includes(" | ")
        ? title.split(" | ")[0]
        : title.split(" - ")[0]) ||
      null;

    /* ---------- Links ---------- */
    const pageLinks = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean);

    /* ---------- 13 Signals ---------- */
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

    /* ---------- Aggregate Score ---------- */
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

    /* ---------- Scoring Bars ---------- */
    const scoringBars = results.map((r) => ({
      key: r.key,
      points: r.points,
      max: r.max,
      percent: r.max ? Math.round((r.points / r.max) * 100) : 0,
      notes: r.notes,
    }));

    /* ---------- Tier Scores ---------- */
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

    /* ---------- Response ---------- */
    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: host,
      entityName,
      title,
      canonical: canonicalHref,
      description,
      entityScore,

      entityStage: entityTier.stage,
      entityVerb: entityTier.verb,
      entityDescription: entityTier.description,
      entityFocus: entityTier.coreFocus,

      breakdown: results,
      scoringBars,
      tierScores,

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
