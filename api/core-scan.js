// /api/core-scan.js — EEI Crawl v2.8
// Entity-first | Multi-surface | Static-first | AI crawl simulation

import axios from "axios";
import * as cheerio from "cheerio";

/* ============================================================
   GLOBAL CONFIG
   ============================================================ */
export const CRAWL_CONFIG = {
  TIMEOUT_MS: 20000,
  MAX_REDIRECTS: 5,

  STATIC_UA:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-crawl/2.8 Safari/537.36",

  AI_UAS: [
    "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
    "ClaudeBot/1.0 (+https://www.anthropic.com/claudebot)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; exmxc-crawl/2.8; +https://exmxc.ai/eei)"
  ]
};

/* ============================================================
   HELPERS
   ============================================================ */
function getRandomAiUA() {
  return CRAWL_CONFIG.AI_UAS[
    Math.floor(Math.random() * CRAWL_CONFIG.AI_UAS.length)
  ];
}

function classifyError(err) {
  const msg = err?.message || "";
  if (/timeout/i.test(msg)) return "timeout";
  if (/403|429|blocked/i.test(msg)) return "blocked";
  if (/network|ECONNREFUSED/i.test(msg)) return "network";
  return "unknown";
}

/* ============================================================
   SURFACE DISCOVERY (ENTITY-LEVEL)
   ============================================================ */
const DEFAULT_SURFACES = [
  "/",
  "/about",
  "/about-us",
  "/method",
  "/longevity",
  "/science",
  "/blog",
  "/trail-logs",
  "/podcast"
];

function resolveSurfaces(baseUrl, discoveredLinks = []) {
  const origin = new URL(baseUrl).origin;

  const discovered = discoveredLinks
    .map((href) => {
      try {
        return new URL(href, origin).pathname;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const merged = new Set([
    "/",
    ...DEFAULT_SURFACES,
    ...discovered
  ]);

  // Hard cap: AI samples surfaces, it doesn’t index the site
  return Array.from(merged)
    .filter((p) => p.startsWith("/"))
    .slice(0, 6);
}

/* ============================================================
   JSON-LD PARSER
   ============================================================ */
function parseJsonLd(rawBlocks = []) {
  const objects = [];
  let errorCount = 0;
  let latestISO = null;

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

  for (const o of objects) {
    for (const k of ["dateModified", "datePublished", "uploadDate"]) {
      if (o?.[k]) {
        const d = new Date(o[k]);
        if (!isNaN(d) && (!latestISO || d > new Date(latestISO))) {
          latestISO = d.toISOString();
        }
      }
    }
  }

  return { schemaObjects: objects, latestISO, jsonLdErrorCount: errorCount };
}

/* ============================================================
   STATIC CRAWL (BASELINE)
   ============================================================ */
async function staticCrawl(url) {
  const resp = await axios.get(url, {
    timeout: CRAWL_CONFIG.TIMEOUT_MS,
    maxRedirects: CRAWL_CONFIG.MAX_REDIRECTS,
    headers: {
      "User-Agent": CRAWL_CONFIG.STATIC_UA,
      Accept: "text/html,application/xhtml+xml"
    },
    validateStatus: (s) => s >= 200 && s < 400
  });

  const finalUrl = resp.request?.res?.responseUrl || url;
  const html = typeof resp.data === "string" ? resp.data : "";
  const $ = cheerio.load(html);

  const ldTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get();

  const { schemaObjects, latestISO, jsonLdErrorCount } =
    parseJsonLd(ldTexts);

  const rawLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  return {
    mode: "static",
    status: resp.status,
    url: finalUrl,
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
    diagnostics: {
      wordCount,
      linkCount: rawLinks.length,
      schemaCount: schemaObjects.length,
      jsonLdErrorCount
    }
  };
}

/* ============================================================
   CONDITIONAL RENDERED CRAWL
   ============================================================ */
async function renderedCrawl(url) {
  const { chromium } = await import("playwright-core");
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
    const $ = cheerio.load(html);

    const ldBlocks = await page.$$eval(
      'script[type="application/ld+json"]',
      (nodes) => nodes.map((n) => n.textContent || "")
    );

    const { schemaObjects, latestISO, jsonLdErrorCount } =
      parseJsonLd(ldBlocks);

    const bodyText = $("body").text().replace(/\s+/g, " ").trim();

    return {
      mode: "rendered",
      status: page.response()?.status() || 200,
      url,
      title: await page.title(),
      description:
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        "",
      canonicalHref:
        $('link[rel="canonical"]').attr("href") || url,
      pageLinks: [],
      schemaObjects,
      latestISO,
      diagnostics: {
        wordCount: bodyText.split(" ").length,
        jsonLdErrorCount
      }
    };
  } finally {
    await browser.close();
  }
}

/* ============================================================
   ESCALATION DECISION
   ============================================================ */
function shouldEscalate(result) {
  const d = result.diagnostics || {};
  if (d.wordCount < 200) return true;
  if (d.schemaCount === 0) return true;
  return false;
}

/* ============================================================
   MULTI-SURFACE ENTITY CRAWL
   ============================================================ */
async function crawlSurfaces({ url, mode }) {
  const root = await staticCrawl(url);

  const surfaces = resolveSurfaces(
    root.url,
    root.pageLinks || []
  );

  const surfaceResults = [];

  for (const path of surfaces) {
    const surfaceUrl = new URL(path, root.url).href;
    try {
      let r = await staticCrawl(surfaceUrl);
      if (shouldEscalate(r) || mode === "rendered") {
        try {
          r = await renderedCrawl(surfaceUrl);
        } catch {}
      }
      surfaceResults.push({ surface: path, ...r });
    } catch {}
  }

  return {
    entity: root,
    surfaces: surfaceResults
  };
}

/* ============================================================
   PUBLIC API
   ============================================================ */
export async function crawlPage({
  url,
  mode = "static",
  multiSurface = true
}) {
  try {
    if (multiSurface) {
      return await crawlSurfaces({ url, mode });
    }

    const single = await staticCrawl(url);
    if (shouldEscalate(single) || mode === "rendered") {
      try {
        return await renderedCrawl(url);
      } catch {
        return single;
      }
    }

    return single;
  } catch (err) {
    return {
      error: err.message,
      diagnostics: {
        errorType: classifyError(err)
      }
    };
  }
}
