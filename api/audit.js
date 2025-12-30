// /api/audit.js — EEI v7.1 (Strategic Category + ECC + Tier Bars)
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

/* ------------------------
   UTILITIES
-------------------------*/
function normalizeUrl(input) {
  let u = (input || "").trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); } catch { return null; }
}

function hostnameOf(urlStr) {
  try { return new URL(urlStr).hostname.replace(/^www\./i, ""); }
  catch { return ""; }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ------------------------
   TIER GROUPING
-------------------------*/
const SIGNAL_TIER = {
  "Social Entity Links": "tier1",
  "Internal Lattice Integrity": "tier1",
  "External Authority Signal": "tier1",
  "AI Crawl Fidelity": "tier1",
  "Inference Efficiency": "tier1",

  "Schema Presence & Validity": "tier2",
  "Organization Schema": "tier2",
  "Breadcrumb Schema": "tier2",
  "Author/Person Schema": "tier2",

  "Title Precision": "tier3",
  "Meta Description Integrity": "tier3",
  "Canonical Clarity": "tier3",
  "Brand & Technical Consistency": "tier3",
};

const TIER_LABELS = {
  tier1: "Entity comprehension & trust",
  tier2: "Structural data fidelity",
  tier3: "Page-level hygiene",
};

/* ------------------------
   STRATEGIC CATEGORY LOGIC
-------------------------*/
function categorizeSurface({ staticBlocked, renderedBlocked, botDefenseHits }) {
  if (staticBlocked || renderedBlocked) return "blocked";
  if (botDefenseHits && botDefenseHits.length > 0) return "defensive";
  return "open";
}

/* ------------------------
   MAIN HANDLER
-------------------------*/
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const input = req.query?.url;
    if (!input) return res.status(400).json({ error: "Missing URL" });

    const normalized = normalizeUrl(input);
    if (!normalized)
      return res.status(400).json({ error: "Invalid URL format" });

    const host = hostnameOf(normalized);

    /* ----- Crawl ----- */
    const crawl = await crawlPage({ url: normalized, mode: "rendered" });

    // If crawl truly fails, treat as BLOCKED — not an error
    if (crawl.error || !crawl.html) {
      return res.status(200).json({
        success: true,
        url: normalized,
        hostname: host,
        category: "blocked",
        ecc: { score: 0, band: "none", max: 100 },
        tierScores: null,
        breakdown: [],
        rationale: "Site blocked or gated at crawl boundary",
        timestamp: new Date().toISOString(),
      });
    }

    const {
      html,
      schemaObjects,
      pageLinks,
      staticBlocked,
      renderedBlocked,
      botDefenseHits = [],
    } = crawl;

    const $ = cheerio.load(html);

    /* ----- Category Decision ----- */
    const category = categorizeSurface({
      staticBlocked,
      renderedBlocked,
      botDefenseHits,
    });

    /* If BLOCKED or DEFENSIVE, we still score observable surface,
       but strategic meaning comes from category */
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

    /* ----- Aggregate Score + Tiers ----- */
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

    const eccScore = clamp(Math.round((totalRaw * 100) / TOTAL_WEIGHT), 0, 100);

    const tierScores = {
      tier1: {
        label: TIER_LABELS.tier1,
        raw: tierRaw.tier1,
        max: tierMax.tier1,
        normalized: tierMax.tier1
          ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2))
          : 0,
      },
      tier2: {
        label: TIER_LABELS.tier2,
        raw: tierRaw.tier2,
        max: tierMax.tier2,
        normalized: tierMax.tier2
          ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2))
          : 0,
      },
      tier3: {
        label: TIER_LABELS.tier3,
        raw: tierRaw.tier3,
        max: tierMax.tier3,
        normalized: tierMax.tier3
          ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2))
          : 0,
      },
    };

    const band =
      eccScore >= 90
        ? "sovereign"
        : eccScore >= 75
        ? "strong"
        : eccScore >= 55
        ? "emerging"
        : "weak";

    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: host,

      category, // 🔒 blocked | 🛡 defensive | 🌐 open

      ecc: {
        score: eccScore,
        band,
        max: 100,
      },

      tierScores,
      breakdown: results,

      defenses: {
        staticBlocked: !!staticBlocked,
        renderedBlocked: !!renderedBlocked,
        botDefenseHits,
      },

      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      detail: err.message || String(err),
    });
  }
}
