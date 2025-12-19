// /api/core-scan.js — EEI Core Scan v3.0
// Static-first entity crawl
// Rendered crawl is DIAGNOSTIC ONLY (AI obstruction detection)
// No scoring. No ontology. No guessing.

import axios from "axios";
import * as cheerio from "cheerio";

/* ============================================================
   CONFIG
   ============================================================ */

export const CRAWL_CONFIG = {
  TIMEOUT_MS: 20000,
  MAX_REDIRECTS: 5,

  STATIC_UA:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-static/3.0 Safari/537.36",

  AI_UAS: [
    "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
    "ClaudeBot/1.0 (+https://www.anthropic.com/claudebot)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
  ]
};

/* ============================================================
   HELPERS
   ============================================================ */

function randomAiUA() {
  return CRAWL_CONFIG.AI_UAS[
    Math.floor(Math.random() * CRAWL_CONFIG.AI_UAS.length)
  ];
}

function normalizeUrl(input) {
  try {
    return new URL(input).href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/* ============================================================
   JSON-LD PARSER
   ============================================================ */

function parseJsonLd(rawBlocks = []) {
  const objects = [];
  let errorCount = 0;

  for (const raw of rawBlocks) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) objects.push(...parsed);
      else if (parsed["@graph"]) objects.push(...parsed["@graph"]);
      else objects.push(parsed);
    } catch {
      errorCount++;
    }
  }

  return {
    schemaObjects: objects,
    jsonLdErrorCount: errorCount
  };
}

/* ============================================================
   STATIC CRAWL (AUTHORITATIVE)
   ============================================================ */

export async function staticCrawl(url) {
  const resp = await axios.get(url, {
    timeout: CRAWL_CONFIG.TIMEOUT_MS,
    maxRedirects: CRAWL_CONFIG.MAX_REDIRECTS,
    headers: {
      "User-Agent": CRAWL_CONFIG.STATIC_UA,
      Accept: "text/html"
    },
    validateStatus: s => s >= 200 && s < 400
  });

  const finalUrl = resp.request?.res?.responseUrl || url;
  const html = typeof resp.data === "string" ? resp.data : "";

  const $ = cheerio.load(html);

  const ldTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get();

  const { schemaObjects, jsonLdErrorCount } = parseJsonLd(ldTexts);

  const pageLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  return {
    mode: "static",
    url: finalUrl,

    html,
    title: $("title").first().text().trim(),
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",

    canonicalHref:
      $('link[rel="canonical"]').attr("href") ||
      finalUrl,

    schemaObjects,
    pageLinks,

    diagnostics: {
      wordCount,
      linkCount: pageLinks.length,
      schemaCount: schemaObjects.length,
      jsonLdErrorCount
    }
  };
}

/* ============================================================
   RENDERED PROBE (DIAGNOSTIC ONLY)
   ============================================================ */

export async function renderedProbe(url) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent: randomAiUA()
    });

    await page.goto(url, {
      timeout: CRAWL_CONFIG.TIMEOUT_MS,
      waitUntil: "networkidle"
    });

    const html = await page.content();
    const $ = cheerio.load(html);

    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const wordCount = bodyText ? bodyText.split(" ").length : 0;

    const robots =
      $('meta[name="robots"]').attr("content") || "";

    return {
      mode: "rendered",
      url,
      wordCount,
      robots,
      blocked:
        /noindex|nofollow|captcha|attention required/i.test(
          page.title() + robots
        )
    };
  } finally {
    await browser.close();
  }
}

/* ============================================================
   MULTI-SURFACE ENTITY SCAN
   ============================================================ */

export async function coreScan({
  url,
  surfaces = [],
  probeRendered = false
}) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error("Invalid URL");

  const results = [];

  for (const surface of surfaces) {
    const surfaceUrl = normalizeUrl(surface);
    if (!surfaceUrl) continue;

    try {
      const staticResult = await staticCrawl(surfaceUrl);
      results.push({
        surface,
        ...staticResult
      });
    } catch {
      // skip failed surface
    }
  }

  let renderedDiagnostics = null;

  if (probeRendered) {
    try {
      renderedDiagnostics = await renderedProbe(normalized);
    } catch {
      renderedDiagnostics = {
        blocked: true,
        reason: "rendered-probe-failed"
      };
    }
  }

  return {
    success: true,
    url: normalized,
    surfaces: results,
    renderedDiagnostics
  };
}
