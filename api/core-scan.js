// /api/core-scan.js — EEI Crawl v3.0
// STATIC = Capability (ECC)
// RENDERED = Intent detection ONLY
// No scoring, no word counts, no schema credit from rendered

import axios from "axios";
import * as cheerio from "cheerio";

/* ============================================================
   GLOBAL CONFIG
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

function parseJsonLd(blocks = []) {
  const objects = [];
  for (const raw of blocks) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) objects.push(...parsed);
      else if (parsed["@graph"]) objects.push(...parsed["@graph"]);
      else objects.push(parsed);
    } catch {}
  }
  return objects;
}

/* ============================================================
   STATIC CRAWL (ECC SOURCE OF TRUTH)
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

  const schemaObjects = parseJsonLd(
    $('script[type="application/ld+json"]')
      .map((_, el) => $(el).text())
      .get()
  );

  const pageLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

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
      finalUrl.replace(/\/$/, ""),
    favicon:
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href") ||
      "",
    ogImage: $('meta[property="og:image"]').attr("content") || "",
    schemaObjects,
    pageLinks,
    diagnostics: {
      wordCount: bodyText ? bodyText.split(" ").length : 0,
      schemaCount: schemaObjects.length,
      linkCount: pageLinks.length
    }
  };
}

/* ============================================================
   RENDERED CRAWL (INTENT ONLY — NO SCORING DATA)
============================================================ */
export async function renderedIntentProbe(url) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ userAgent: randomAiUA() });
    await page.goto(url, { timeout: CRAWL_CONFIG.TIMEOUT_MS, waitUntil: "networkidle" });

    const html = await page.content();
    const $ = cheerio.load(html);

    const renderedSchemas = parseJsonLd(
      await page.$$eval(
        'script[type="application/ld+json"]',
        nodes => nodes.map(n => n.textContent || "")
      )
    );

    return {
      mode: "rendered",
      intentSignals: {
        renderedSchemaCount: renderedSchemas.length,
        jsOnlySchema: renderedSchemas.length > 0,
        botAccessible: true
      }
    };
  } catch {
    return {
      mode: "rendered",
      intentSignals: {
        botAccessible: false
      }
    };
  } finally {
    await browser.close();
  }
}

/* ============================================================
   PUBLIC API
============================================================ */
export async function crawlEntity({ url, detectIntent = false }) {
  const staticResult = await staticCrawl(url);

  let intent = null;
  if (detectIntent) {
    intent = await renderedIntentProbe(url);
  }

  return {
    static: staticResult,   // ECC input
    intent                 // posture only
  };
}
