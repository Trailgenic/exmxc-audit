// /api/audit.js — EEI v3.3 (Evolutionary Scoring + Internal Relay + Safe Allowlist)
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

/* ================================
   CONFIG
   ================================ */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/3.3 Safari/537.36";

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

function tryParseJSON(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
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
  const isInternal = req.headers["x-exmxc-key"] === "exmxc-internal";
  const referer = req.headers.referer || "";

  // allow official origins
  const isExternal =
    !(
      referer.includes("exmxc.ai") ||
      referer.includes("localhost") ||
      referer.includes("vercel.app")
    ) && !isInternal;

  if (isExternal) {
    return res.status(401).json({
      error: "Access denied (401)",
      note: "External calls blocked",
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

    // --- Fetch HTML content ---
    let html = "";
    try {
      const resp = await axios.get(normalized, {
        timeout: 15000,
        maxRedirects: 5,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      html = resp.data || "";
    } catch (e) {
      return res.status(500).json({
        error: "Failed to fetch URL",
        details: e?.message || "Request blocked or timed out",
        url: normalized,
      });
    }

    const $ = cheerio.load(html);

    // --- Collect site signals ---
    const title = ($("title").first().text() || "").trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const canonicalHref =
      $('link[rel="canonical"]').attr("href") || normalized.replace(/\/$/, "");

    const pageLinks = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean);

    const ldBlocks = $("script[type='application/ld+json']")
      .map((_, el) => $(el).contents().text())
      .get();

    const schemaObjects = ldBlocks.flatMap(tryParseJSON);

    // --- Find latest content date ---
    let latestISO = null;
    for (const obj of schemaObjects) {
      const ds = [
        obj.dateModified,
        obj.dateUpdated,
        obj.datePublished,
        obj.uploadDate,
      ].filter(Boolean);
      ds.forEach((dc) => {
        const d = new Date(dc);
        if (!Number.isNaN(d.getTime())) {
          if (!latestISO || d > new Date(latestISO))
            latestISO = d.toISOString();
        }
      });
    }

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
