// /api/audit.js — EEI v3.4 (Crawl v2 Integration + Evolutionary Scoring)
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
import { crawlPage } from "./core-scan.js";

/* ================================
   CONFIG
   ================================ */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/3.4 Safari/537.36";

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
const allowedOrigins = [
  "localhost",
  "127.0.0.1",
  "vercel.app",
  "exmxc.ai",
];

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

    // --- Score using modular functions (unchanged logic) ---
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

    // --- Calculate composite score ---
    const entityScore = clamp(
      breakdown.reduce((sum, b) => sum + clamp(b.points, 0, b.max), 0),
      0,
      100
    );

    // --- Get evolutionary tier info ---
    const entityTier = tierFromScore(entityScore);

    // --- Add normalized strengths ---
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
      entityScore: Math.round(entityScore),

      // 🌕 Evolutionary Layer Output
      entityStage: entityTier.stage,
      entityVerb: entityTier.verb,
      entityDescription: entityTier.description,
      entityFocus: entityTier.coreFocus,

      signals: breakdown,
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
