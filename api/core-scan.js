// /api/core-scan.js — EEI Crawl v2.8
// Static-first | Conditional Playwright | Multi-surface Entity Crawl
// No ontology. No recursion. AI-comprehension aligned.

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
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
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
  return "unknown";
}

/* ============================================================
   SURFACE DISCOVERY (ENTITY LEVEL)
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

  return Array.from(
    new Set(["/", ...DEFAULT_SURFACES, ...discovered])
  )
    .filter((p) => p.startsWith("/"))
    .slice(0, 6); // 🔒 HARD CAP
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
  for (const o of objects) {
    const d = o?.dateModified || o?.datePublished;
    if (d) {
      const parsed = new Date(d);
      if (!isNaN(parsed)) {
        if (!latestISO || parsed > new Date(latestISO)) {
          latestISO = parsed.toISOString();
        }
      }
    }
  }

  return { schemaObjects: objects, latestISO, errorCount };
}

/* ============================================================
   STATIC CRAWL (SINGLE SURFACE)
   ============================================================ */
async function staticCrawl(url) {
  const resp = await axios.get(url, {
    timeout: CRAWL_CONFIG.TIMEOUT_MS,
    maxRedirects: CRAWL_CONFIG.MAX_REDIRECTS,
    headers: {
      "User-Agent": CRAWL_CONFIG.STATIC_UA,
      Accept: "text/html"
    }
  });

  const finalUrl = resp.request?.res?.responseUrl || url;
  const html = resp.data || "";
  const $ = cheerio.load(html);

  const ldTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get();

  const { schemaObjects, latestISO } = parseJsonLd(ldTexts);

  const links = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  return {
    mode: "static",
    status: resp.status,
    title: $("title").first().text().trim(),
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",
    canonicalHref:
      $('link[rel="canonical"]').attr("href") ||
      finalUrl.replace(/\/$/, ""),
    pageLinks: links,
    schemaObjects,
    latestISO,
    diagnostics: {
      finalUrl,
      wordCount,
      scriptCount: $("script").length,
      hasNoscript: $("noscript").length > 0
    }
  };
}

/* ============================================================
   CONDITIONAL PLAYWRIGHT (ESCALATION ONLY)
   ============================================================ */
async function renderedCrawl(url) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ userAgent: getRandomAiUA() });
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    const ldTexts = $('script[type="application/ld+json"]')
      .map((_, el) => $(el).text())
      .get();

    const { schemaObjects, latestISO } = parseJsonLd(ldTexts);
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();

    return {
      mode: "rendered",
      title: await page.title(),
      description:
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        "",
      canonicalHref:
        $('link[rel="canonical"]').attr("href") || url,
      pageLinks: $("a[href]").map((_, el) => $(el).attr("href")).get(),
      schemaObjects,
      latestISO,
      diagnostics: {
        wordCount: bodyText.split(" ").length
      }
    };
  } finally {
    await browser.close();
  }
}

/* ============================================================
   SINGLE SURFACE API (UNCHANGED CONTRACT)
   ============================================================ */
export async function crawlPage({ url, mode = "static" }) {
  try {
    const result = await staticCrawl(url);

    if (
      mode === "rendered" ||
      result.diagnostics.wordCount < 200 ||
      result.schemaObjects.length === 0
    ) {
      return await renderedCrawl(url);
    }

    return result;
  } catch (err) {
    return {
      error: err.message,
      diagnostics: { errorType: classifyError(err) }
    };
  }
}

/* ============================================================
   MULTI-SURFACE ENTITY CRAWL (NEW)
   ============================================================ */
export async function crawlEntity({ url, mode = "static" }) {
  const base = await crawlPage({ url, mode });
  const surfaces = resolveSurfaces(
    base.diagnostics?.finalUrl || url,
    base.pageLinks || []
  );

  const results = [];
  for (const path of surfaces) {
    const surfaceUrl = new URL(path, url).href;
    try {
      results.push(await crawlPage({ url: surfaceUrl, mode }));
    } catch {}
  }

  // 🔑 ENTITY MERGE (AI-style)
  const schemaMap = new Map();
  let latestISO = base.latestISO || null;
  let maxWordCount = 0;

  for (const r of results) {
    for (const s of r.schemaObjects || []) {
      schemaMap.set(s["@id"] || JSON.stringify(s), s);
    }
    if (r.latestISO && (!latestISO || r.latestISO > latestISO)) {
      latestISO = r.latestISO;
    }
    maxWordCount = Math.max(maxWordCount, r.diagnostics?.wordCount || 0);
  }

  return {
    mode: "multi-surface",
    surfaces,
    schemaObjects: Array.from(schemaMap.values()),
    latestISO,
    diagnostics: {
      wordCount: maxWordCount
    }
  };
}
