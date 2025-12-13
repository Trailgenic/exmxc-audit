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
   STATIC CRAWL (Baseline)
   ============================================================ */
async function staticCrawl(url, timeoutMs, userAgent) {
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    maxRedirects: 5,
    responseType: "text",
    headers: {
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml"
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const html = typeof resp.data === "string" ? resp.data : "";
  const $ = cheerio.load(html);

  const ldTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get();

  const { schemaObjects, latestISO, schemaStats } = parseJsonLd(ldTexts);

  const pageLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  return {
    _type: "static",
    status: resp.status,
    html,
    title: $("title").first().text().trim(),
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",
    canonicalHref:
      $('link[rel="canonical"]').attr("href") || url.replace(/\/$/, ""),
    pageLinks,
    schemaObjects,
    latestISO,
    diagnostics: {
      htmlBytes: html.length,
      wordCount,
      linkCount: pageLinks.length,
      jsonLdCount: schemaStats.ldJsonCount,
      jsonLdErrorCount: schemaStats.ldJsonErrorCount,
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
