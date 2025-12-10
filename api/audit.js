// /api/audit.js — EEI v4.1 (Playwright + @graph + Gravity + CrawlHealth + MultiPage)

import axios from "axios";
import * as cheerio from "cheerio";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";

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

import { computeGravity } from "../shared/gravity.js";
import { crawlHealth } from "../crawl/crawlHealth.js";
import { crawlMultiPage } from "../crawl/crawlMultiPage.js";

/* ================== Helpers =================== */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/4.1 Safari/537.36";

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

/* ================== Handler =================== */
export default async function handler(req, res) {
  /* ================== CORS =================== */
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

  if (normalizedOrigin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.status(200).end();

  res.setHeader("Content-Type", "application/json");

  /* ================== Access Gate (Updated Option A) =================== */

  const referer = req.headers.referer || "";
  const isInternal = req.headers["x-exmxc-key"] === "exmxc-internal";

  const allowedOrigins = [
    "exmxc.ai",
    "www.exmxc.ai",
    "localhost",
    "vercel.app"
  ];

  const isAllowedOrigin = allowedOrigins.some(o =>
    referer.includes(o)
  );

  // Webflow privacy mode often sends no referer — allow this
  const noRefererSafe = referer === "";

  const isExternal = !(isAllowedOrigin || noRefererSafe || isInternal);

  if (isExternal) {
    return res.status(401).json({
      error: "Access denied (401)",
      note: "External calls blocked"
    });
  }

  /* ================== Main Logic =================== */
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

    /* ================== Fetch with Playwright =================== */
    let html = "";
    let renderFailed = false;
    let axiosFailed = false;

    try {
      const executablePath = await chromium.executablePath;

      const browser = await playwrightChromium.launch({
        args: chromium.args,
        executablePath,
        headless: true,
      });

      const page = await browser.newPage({ userAgent: UA });
      await page.goto(normalized, {
        waitUntil: "networkidle",
        timeout: 20000,
      });

      html = await page.content();
      await browser.close();
    } catch (e) {
      renderFailed = true;
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
      } catch {
        axiosFailed = true;
        return res.status(500).json({
          error: "Failed to fetch/render URL",
          url: normalized,
        });
      }
    }

    /* ================== Parsing =================== */
    const $ = cheerio.load(html);

    const ldBlocks = $("script[type='application/ld+json']")
      .map((_, el) => $(el).contents().text())
      .get();

    const rawSchemas = ldBlocks.flatMap(tryParseJSON);

    const expandedSchemas = [];
    for (const obj of rawSchemas) {
      if (Array.isArray(obj["@graph"])) expandedSchemas.push(...obj["@graph"]);
      else expandedSchemas.push(obj);
    }
    const schemaObjects = expandedSchemas;

    /* ================== Basic Fields =================== */
    const title = ($("title").first().text() || "").trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    const canonicalHref =
      $('link[rel="canonical"]').attr("href") ||
      normalized.replace(/\/$/, "");

    const pageLinks = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean);

    // track latest date
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

    /* ================== Scoring =================== */
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

    const entityScore = clamp(
      breakdown.reduce((sum, b) => sum + clamp(b.points, 0, b.max), 0),
      0,
      100
    );

    const entityTier = tierFromScore(entityScore);

    breakdown.forEach((b) => {
      b.strength = b.max
        ? Number((clamp(b.points, 0, b.max) / b.max).toFixed(3))
        : 0;
    });

    /* ================== Gravity =================== */
    const gravity = computeGravity({
      hostname: originHost,
      pageLinks,
    });

    /* ================== Crawl Health =================== */
    const crawl = crawlHealth({
      $,
      normalized,
      renderFailed,
      axiosFailed,
    });

    /* ================== Multi-page Crawl (Internal Only) =================== */
    let multiPage = null;
    if (isInternal) {
      try {
        multiPage = await crawlMultiPage(normalized, {
          depth: 2,
          maxPages: 10,
        });
      } catch (err) {
        multiPage = {
          success: false,
          error: err?.message || String(err),
        };
      }
    }

    /* ================== Response =================== */
    return res.status(200).json({
      success: true,
      model: "EEI v4.1 (Playwright + @graph + Gravity + CrawlHealth + MultiPage)",
      url: normalized,
      hostname: originHost,
      entityName: entityName || null,
      title,
      canonical: canonicalHref,
      description,
      entityScore: Math.round(entityScore),

      entityStage: entityTier.stage,
      entityVerb: entityTier.verb,
      entityDescription: entityTier.description,
      entityFocus: entityTier.coreFocus,

      gravity,
      crawlHealth: crawl,
      multiPage,

      signals: breakdown,
      schemaMeta: {
        schemaBlocks: schemaObjects.length,
        latestISO,
      },

      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message || String(err),
    });
  }
}
