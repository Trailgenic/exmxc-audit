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
   CONFIG
   ================================ */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/5.0 Safari/537.36";

/* ---------- Helpers ---------- */
function normalizeUrl(input) {
  let url = (input || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (!u.pathname) u.pathname = "/";
    return u.toString();
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

/* ---------- Tier Mapping (for aggregated V5 tiers) ---------- */
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
  // --- Basic CORS handling ---
  const origin = req.headers.origin || req.headers.referer;
  let normalizedOrigin = "*";
  if (origin && origin !== "null") {
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      normalizedOrigin = "*";
    }
  }
  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, x-exmxc-key"
  );
  if (normalizedOrigin !== "*")
    res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();

  res.setHeader("Content-Type", "application/json");

  /* ================================
     INTERNAL RELAY BYPASS + SAFELIST
     ================================ */
  // Determine internal key (must be defined BEFORE checks)
  const isInternal = req.headers["x-exmxc-key"] === "exmxc-internal";

  // Pull referer/origin safely
  const referer = req.headers.referer || "";
  const originHeader = req.headers.origin || "";

  // Allow localhost, Vercel, and exmxc.ai
  const allowedOrigins = ["localhost", "127.0.0.1", "vercel.app", "exmxc.ai"];

  // Combine for easier detection
  const originString = `${referer} ${originHeader}`.toLowerCase();

  // External = NOT internal AND NOT in safelist
  const isExternal =
    !isInternal &&
    !allowedOrigins.some((allowed) => originString.includes(allowed));

  if (isExternal) {
    return res.status(401).json({
      error: "Access denied (401) — origin not allowed",
      originString,
    });
  }

  /* ================================
     MAIN AUDIT EXECUTION
     ================================ */
  try {
    const input = req.query?.url;
    if (!input || typeof input !== "string" || !input.trim()) {
      return res.status(400).json({ error: "Missing URL" });
    }

    const normalized = normalizeUrl(input);
    if (!normalized) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const originHost = hostnameOf(normalized);

    // Support ?mode=static for A/B or debugging; default to rendered
    const requestedMode = req.query?.mode === "static" ? "static" : "rendered";

    // --- EEI Crawl v2: rendered-first crawl with static fallback ---
    const crawl = await crawlPage({
      url: normalized,
      mode: requestedMode,
      userAgent: UA,
    });

    if (crawl.error || !crawl.html) {
      const statusCode =
        (crawl.status && crawl.status >= 400 && crawl.status < 600
          ? crawl.status
          : 500) || 500;

      return res.status(statusCode).json({
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

    const $ = cheerio.load(html || "");

    // Prefer crawl-derived fields, but keep current behavior semantics
    const title = (crawlTitle || $("title").first().text() || "").trim();
    const description =
      crawlDescription ||
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    const canonicalHref =
      crawlCanonical ||
      $('link[rel="canonical"]').attr("href") ||
      normalized.replace(/\/$/, "");

    // --- Determine entity name ---
    let entityName =
      schemaObjects.find(
        (o) => o["@type"] === "Organization" && typeof o.name === "string"
      )?.name ||
      schemaObjects.find(
        (o) => o["@type"] === "Person" && typeof o.name === "string"
      )?.name ||
      (title.includes(" | ")
        ? title.split(" | ")[0]
        : title.split(" - ")[0]);
    entityName = (entityName || "").trim();

    // --- Score using modular functions ---
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
      scoreInternalLinks(pageLinks, originHost),
      scoreExternalLinks(pageLinks, originHost),
      scoreFaviconOg($),
    ];

    // --- Build map by key for tier logic ---
    const byKey = {};
    for (const sig of breakdown) {
      if (sig && sig.key) byKey[sig.key] = sig;
    }

    // --- V5 aggregation: normalized 0–100 using TOTAL_WEIGHT (105 → 100) ---
    let totalRaw = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

    for (const sig of breakdown) {
      if (!sig || typeof sig.max !== "number") continue;
      const max = sig.max || 0;
      const safePoints = clamp(sig.points ?? 0, 0, max);
      const key = sig.key || "";
      const tier = SIGNAL_TIER[key] || "tier3";

      totalRaw += safePoints;
      tierRaw[tier] += safePoints;
      tierMax[tier] += max;
    }

    const weightTotal =
      typeof TOTAL_WEIGHT === "number" && TOTAL_WEIGHT > 0
        ? TOTAL_WEIGHT
        : Object.values(tierMax).reduce((sum, v) => sum + (v || 0), 0);

    const entityScore = weightTotal
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

    // --- Get evolutionary tier info from V5 score ---
    const entityTier = tierFromScore(entityScore);

    // --- Add normalized strengths per signal ---
    breakdown.forEach((b) => {
      b.strength = b.max
        ? Number((clamp(b.points, 0, b.max) / b.max).toFixed(3))
        : 0;
    });

    // --- Return results ---
    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: originHost,
      entityName: entityName || null,
      title,
      canonical: canonicalHref,
      description,
      entityScore, // V5-normalized score (0–100)

      // 🌕 Evolutionary Layer Output (V5)
      entityStage: entityTier.stage,
      entityVerb: entityTier.verb,
      entityDescription: entityTier.description,
      entityFocus: entityTier.coreFocus,

      signals: breakdown,
      tierScores, // tier1 / tier2 / tier3 breakdown for diagnostics

      schemaMeta: {
        schemaBlocks: schemaObjects.length,
        latestISO,
        rendered,
        mode: resolvedMode,
        httpStatus: httpStatus || null,
        fallbackFromRendered: !!fallbackFromRendered,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("EEI Audit Error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message || String(err),
    });
  }
}
