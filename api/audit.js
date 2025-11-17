// /api/audit.js — EEI v5 Unified (V4 Framework + Tiered Scoring & Full Crawl)
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
import { crawlPage } from "./core-scan.js";

/* ================================
   HELPERS
   ================================ */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/5.0 Safari/537.36";

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
  /* ---------- CORS & ORIGIN FIX ---------- */
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const originString = `${origin} ${referer}`.toLowerCase();

  const isInternal = req.headers["x-exmxc-key"] === "exmxc-internal";

  const allowedRoots = [
    "localhost",
    "127.0.0.1",
    "vercel.app",
    "exmxc.ai",
    "trailgenic.com",
  ];

  const isAllowed =
    isInternal ||
    originString.trim() === "" ||
    allowedRoots.some((root) => originString.includes(root));

  if (!isAllowed) {
    return res.status(401).json({
      error: "Access denied (401) — origin not allowed",
      originString,
    });
  }

  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, x-exmxc-key"
  );
  if (req.method === "OPTIONS") return res.status(200).end();

  /* ---------- Input ---------- */
  try {
    const input = req.query?.url;
    if (!input) return res.status(400).json({ error: "Missing URL" });

    const normalized = normalizeUrl(input);
    if (!normalized) return res.status(400).json({ error: "Invalid URL format" });

    const host = hostnameOf(normalized);
    const requestedMode = req.query?.mode === "static" ? "static" : "rendered";

    /* ---------- Full Crawl ---------- */
    const crawl = await crawlPage({
      url: normalized,
      mode: requestedMode,
      userAgent: UA,
    });

    if (crawl.error || !crawl.html) {
      return res.status(crawl.status || 500).json({
        error: crawl.error || "Failed to crawl URL",
        url: normalized,
        mode: crawl.mode,
        rendered: crawl.rendered,
        renderError: crawl.renderError || null,
      });
    }

    const {
      html,
      title: crawlTitle,
      description: crawlDescription,
      canonicalHref: crawlCanonical,
      pageLinks,
      schemaObjects,
      latestISO,
      mode: resolvedMode,
      rendered,
      fallbackFromRendered,
      status: httpStatus,
    } = crawl;

    const $ = cheerio.load(html);

    /* ---------- Extract Fields ---------- */
    const title = (crawlTitle || $("title").text() || "").trim();
    const description =
      crawlDescription ||
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    const canonicalHref =
      crawlCanonical ||
      $('link[rel="canonical"]').attr("href") ||
      normalized.replace(/\/$/, "");

    /* ---------- Entity Name ---------- */
    let entityName =
      schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person")?.name ||
      (title.includes(" | ") ? title.split(" | ")[0] : title.split(" - ")[0]) ||
      "";

    /* ---------- 13-Signal Breakdown ---------- */
    const breakdown = [
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

    /* ---------- Aggregate V5 Score ---------- */
    let totalRaw = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

    for (const sig of breakdown) {
      if (!sig || typeof sig.max !== "number") continue;
      const safe = clamp(sig.points || 0, 0, sig.max);
      const tier = SIGNAL_TIER[sig.key] || "tier3";

      totalRaw += safe;
      tierRaw[tier] += safe;
      tierMax[tier] += sig.max;
    }

    const weightTotal =
      TOTAL_WEIGHT > 0
        ? TOTAL_WEIGHT
        : Object.values(tierMax).reduce((s, v) => s + v, 0);

    const entityScore =
      weightTotal > 0
        ? clamp(Math.round((totalRaw * 100) / weightTotal), 0, 100)
        : 0;

    const tierScores = {
      tier1: {
        label: TIER_LABELS.tier1,
        raw: tierRaw.tier1,
        maxWeight: tierMax.tier1,
        normalized: tierMax.tier1
          ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2))
          : 0,
      },
      tier2: {
        label: TIER_LABELS.tier2,
        raw: tierRaw.tier2,
        maxWeight: tierMax.tier2,
        normalized: tierMax.tier2
          ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2))
          : 0,
      },
      tier3: {
        label: TIER_LABELS.tier3,
        raw: tierRaw.tier3,
        maxWeight: tierMax.tier3,
        normalized: tierMax.tier3
          ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2))
          : 0,
      },
    };

    const entityTier = tierFromScore(entityScore);

    breakdown.forEach((b) => {
      b.strength = b.max ? Number((b.points / b.max).toFixed(3)) : 0;
    });

    /* ---------- Response ---------- */
    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: host,
      entityName: entityName.trim() || null,
      title,
      canonical: canonicalHref,
      description,
      entityScore,

      entityStage: entityTier.stage,
      entityVerb: entityTier.verb,
      entityDescription: entityTier.description,
      entityFocus: entityTier.coreFocus,

      signals: breakdown,
      tierScores,

      schemaMeta: {
        schemaBlocks: schemaObjects.length,
        latestISO,
        rendered,
        mode: resolvedMode,
        httpStatus,
        fallbackFromRendered: !!fallbackFromRendered,
      },

      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
}
