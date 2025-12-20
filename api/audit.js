// /api/audit.js — EEI v6.0
// Unified Audit Endpoint with Public ECI + Internal EEI
// EEI = internal diagnostics
// ECI = public-facing entity clarity intelligence

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
import { buildEciPublicOutput } from "../shared/eci-mapper.js";

/* ============================================================
   HELPERS
   ============================================================ */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

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
    "Content-Type, Authorization, x-exmxc-key"
  );
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    /* ---------- Input ---------- */
    const input = req.query?.url;
    if (!input) {
      return res.status(400).json({ success: false, error: "Missing URL" });
    }

    const normalized = normalizeUrl(input);
    if (!normalized) {
      return res.status(400).json({ success: false, error: "Invalid URL" });
    }

    const hostname = hostnameOf(normalized);
    const mode = req.query?.mode === "static" ? "static" : "rendered";
    const vertical = req.query?.vertical || null;

    /* ---------- Crawl ---------- */
    const crawl = await crawlPage({
      url: normalized,
      mode,
    });

    if (crawl.error || !crawl.html) {
      return res.status(200).json({
        success: false,
        url: normalized,
        hostname,
        error: crawl.error || "Crawl failed",
        crawlHealth: crawl.crawlHealth || null,
      });
    }

    const {
      html,
      title: crawlTitle,
      description: crawlDescription,
      canonicalHref,
      pageLinks = [],
      schemaObjects = [],
      crawlHealth,
      aiConfidence,
    } = crawl;

    const $ = cheerio.load(html);

    /* ---------- Field Extraction ---------- */
    const title = (crawlTitle || $("title").text() || "").trim();
    const description =
      crawlDescription ||
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    /* ---------- EEI Signal Scoring (Internal) ---------- */
    const breakdown = [
      scoreTitle($, { title }),
      scoreMetaDescription($, { description }),
      scoreCanonical($, normalized, { canonicalHref }),
      scoreSchemaPresence(schemaObjects),
      scoreOrgSchema(schemaObjects),
      scoreBreadcrumbSchema(schemaObjects),
      scoreAuthorPerson(schemaObjects, $),
      scoreSocialLinks(schemaObjects, pageLinks),
      scoreAICrawlSignals($),
      scoreContentDepth($, crawlHealth),
      scoreInternalLinks(pageLinks, hostname),
      scoreExternalLinks(pageLinks, hostname),
      scoreFaviconOg($),
    ];

    /* ---------- Aggregate EEI Score ---------- */
    let totalRaw = 0;
    for (const sig of breakdown) {
      totalRaw += clamp(sig.points || 0, 0, sig.max);
    }

    const entityScore = clamp(
      Math.round((totalRaw * 100) / TOTAL_WEIGHT),
      0,
      100
    );

    const eeiTier = tierFromScore(entityScore);

    /* ========================================================
       PUBLIC ECI OUTPUT (STRATEGIC)
       ======================================================== */

    const eciPublic = buildEciPublicOutput({
      entity: {
        name:
          schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
          null,
        url: normalized,
        hostname,
      },
      entityScore,
      breakdown,
      crawlHealth,
      aiConfidence,
      vertical,
    });

    /* ========================================================
       RESPONSE
       ======================================================== */

    return res.status(200).json({
      success: true,

      /* ---------- Public (Safe) ---------- */
      eci: eciPublic,

      /* ---------- Internal (Full) ---------- */
      eei: {
        url: normalized,
        hostname,
        entityScore,
        entityStage: eeiTier.stage,
        entityVerb: eeiTier.verb,
        entityDescription: eeiTier.description,
        entityFocus: eeiTier.coreFocus,
        breakdown,
        crawlHealth,
        aiConfidence,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
}
