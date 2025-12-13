// /api/core-scan.js — EEI Crawl v2.7
// Single-URL | Static-first | Conditional Playwright Escalation
// Designed for defensible EEI scoring & AI-crawl simulation

import axios from "axios";
import * as cheerio from "cheerio";

/* ============================================================
   GLOBAL CONFIG
   ============================================================ */
export const CRAWL_CONFIG = {
  TIMEOUT_MS: 20000,
  MAX_REDIRECTS: 5,
  RETRIES: 1,
  RETRY_DELAY_MS: 300,

  STATIC_UA:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-crawl/2.7 Safari/537.36",

  AI_UAS: [
    "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
    "ClaudeBot/1.0 (+https://www.anthropic.com/claudebot)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; exmxc-crawl/2.7; +https://exmxc.ai/eei)"
  ],

  IS_VERCEL:
    !!process.env.VERCEL ||
    !!process.env.NOW_REGION ||
    !!process.env.VERCEL_ENV
};

/* ============================================================
   HELPERS
   ============================================================ */
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function getRandomAiUA() {
  return CRAWL_CONFIG.AI_UAS[
    Math.floor(Math.random() * CRAWL_CONFIG.AI_UAS.length)
  ];
}

function classifyError(err) {
  const msg = err?.message || "";
  if (/timeout/i.test(msg)) return "timeout";
  if (/blocked|403|429/i.test(msg)) return "blocked";
  if (/network|ECONNREFUSED/i.test(msg)) return "network";
  return "unknown";
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

  let latestISO = null;
  const dateKeys = ["dateModified", "datePublished", "uploadDate"];

  for (const o of objects) {
    for (const k of dateKeys) {
      if (o?.[k]) {
        const d = new Date(o[k]);
        if (!isNaN(d)) {
          if (!latestISO || d > new Date(latestISO)) {
            latestISO = d.toISOString();
          }
        }
      }
    }
  }

  return {
    schemaObjects: objects,
    latestISO,
    jsonLdErrorCount: errorCount
  };
}

/* ============================================================
   STATIC CRAWL (Baseline — FIXED)
   ============================================================ */
async function staticCrawl(url, timeoutMs, userAgent) {
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    maxRedirects: CRAWL_CONFIG.MAX_REDIRECTS,
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  // 🔑 CRITICAL: capture final resolved URL after redirects
  const finalUrl = resp.request?.res?.responseUrl || url;

  const html = typeof resp.data === "string" ? resp.data : "";
  const $ = cheerio.load(html);

  /* ---------- JSON-LD ---------- */
  const ldTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get();

  const { schemaObjects, latestISO, schemaStats } = parseJsonLd(ldTexts);

  /* ---------- Links ---------- */
  const rawLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  let internalLinks = 0;
  let externalLinks = 0;
  let totalLinks = rawLinks.length;

  let origin = null;
  try {
    origin = new URL(finalUrl).origin;
  } catch {
    origin = null;
  }

  for (const href of rawLinks) {
    try {
      const absolute = new URL(href, finalUrl).href;
      const linkOrigin = new URL(absolute).origin;
      if (origin && linkOrigin === origin) internalLinks++;
      else externalLinks++;
    } catch {
      // ignore malformed URLs
    }
  }

  /* ---------- Content ---------- */
  const scriptTags = $("script");
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  const robotsMeta = $('meta[name="robots"]').attr("content") || "";

  /* ---------- Diagnostics ratios ---------- */
  const scriptToWordRatio =
    wordCount > 0 ? scriptTags.length / wordCount : 0;

  const textToHtmlRatio =
    html.length > 0 ? bodyText.length / html.length : 0;

  const schemaDensity =
    wordCount > 0 ? schemaObjects.length / wordCount : 0;

  const hasNoscript = $("noscript").length > 0;

  /* ---------- Return ---------- */
  return {
    _type: "static",
    status: resp.status,
    html,

    // 🔑 use resolved document values
    title: $("title").first().text().trim(),
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",
    canonicalHref:
      $('link[rel="canonical"]').attr("href") ||
      finalUrl.replace(/\/$/, ""),

    pageLinks: rawLinks,
    schemaObjects,
    latestISO,

    userAgentUsed: userAgent,

    diagnostics: {
      finalUrl,
      htmlBytes: html.length,
      textBytes: bodyText.length,
      wordCount,
      domNodes: $("*").length,
      scriptCount: scriptTags.length,
      schemaScriptCount: ldTexts.length,
      imageCount: $("img").length,
      linkCount: totalLinks,
      internalLinkCount: internalLinks,
      externalLinkCount: externalLinks,
      internalLinkRatio:
        totalLinks > 0 ? internalLinks / totalLinks : 0,
      robots: robotsMeta,
      jsonLdCount: schemaStats.ldJsonCount,
      jsonLdValidCount: schemaStats.ldJsonValidCount,
      jsonLdErrorCount: schemaStats.ldJsonErrorCount,
      scriptToWordRatio,
      textToHtmlRatio,
      schemaDensity,
      hasNoscript,
    },
  };
}


/* ============================================================
   CONDITIONAL PLAYWRIGHT
   ============================================================ */
async function renderedCrawl(url) {
  let chromium;
  try {
    chromium = (await import("playwright-core")).chromium;
  } catch {
    throw new Error("playwright-unavailable");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: getRandomAiUA()
    });

    await page.goto(url, {
      timeout: CRAWL_CONFIG.TIMEOUT_MS,
      waitUntil: "networkidle"
    });

    const html = await page.content();

    const ldBlocks = await page.$$eval(
      'script[type="application/ld+json"]',
      (nodes) => nodes.map((n) => n.textContent || "")
    );

    const { schemaObjects, latestISO, jsonLdErrorCount } =
      parseJsonLd(ldBlocks);

    const links =
      (await page.$$eval("a[href]", (nodes) =>
        nodes.map((n) => n.getAttribute("href"))
      )) || [];

    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const wordCount = bodyText.split(" ").length;

    return {
      mode: "rendered",
      status: page.response()?.status() || 200,
      html,
      title: await page.title(),
      description:
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        "",
      canonicalHref:
        $('link[rel="canonical"]').attr("href") || url.replace(/\/$/, ""),
      pageLinks: links,
      schemaObjects,
      latestISO,
      diagnostics: {
        wordCount,
        linkCount: links.length,
        scriptCount: $("script").length,
        jsonLdErrorCount,
        hasNoscript: $("noscript").length > 0
      }
    };
  } finally {
    await browser.close();
  }
}

/* ============================================================
   ESCALATION DECISION
   ============================================================ */
function shouldEscalate(staticResult, requestedMode) {
  if (requestedMode === "rendered") return true;

  const d = staticResult.diagnostics || {};

  if (d.wordCount < 200) return true;
  if (d.scriptCount > 60) return true;
  if (staticResult.schemaObjects.length === 0) return true;
  if (d.hasNoscript) return true;

  return false;
}

/* ============================================================
   PUBLIC API
   ============================================================ */
export async function crawlPage({
  url,
  mode = "static"
}) {
  let attempts = 0;

  try {
    const staticResult = await staticCrawl(url);

    if (shouldEscalate(staticResult, mode)) {
      try {
        return await renderedCrawl(url);
      } catch (err) {
        return staticResult;
      }
    }

    return staticResult;
  } catch (err) {
    return {
      mode,
      status: null,
      html: "",
      title: "",
      description: "",
      canonicalHref: url,
      pageLinks: [],
      schemaObjects: [],
      latestISO: null,
      error: err.message,
      diagnostics: {
        errorType: classifyError(err),
        retryAttempts: attempts
      }
    };
  }
}
