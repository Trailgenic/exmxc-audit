// /api/core-scan.js — EEI Crawl v3.0
// STATIC = Capability (ECC)
// RENDERED = Intent detection ONLY
// No scoring, no word counts, no schema credit from rendered

import * as cheerio from "cheerio";
import { parseJsonLdBlocks } from "../shared/schema-extraction.js";
import { fetchPublicUrl, validateTarget } from "../shared/target-policy.js";

/* ============================================================
   GLOBAL CONFIG
============================================================ */
export const CRAWL_CONFIG = {
  TIMEOUT_MS: 20000,
  MAX_REDIRECTS: 5,
  STATIC_UA: "Mozilla/5.0 (compatible; exmxc-evidence-collector/2.0; +https://exmxc.ai)"
};

/* ============================================================
   HELPERS
============================================================ */
/* ============================================================
   STATIC CRAWL (ECC SOURCE OF TRUTH)
============================================================ */
export async function staticCrawl(url) {
  const validated = validateTarget(url);
  if (!validated.ok) throw Object.assign(new Error(validated.error), { code: "ERR_INVALID_TARGET" });
  const resp = await fetchPublicUrl(validated.url, {
    timeoutMs: CRAWL_CONFIG.TIMEOUT_MS,
    maxRedirects: CRAWL_CONFIG.MAX_REDIRECTS,
    userAgent: CRAWL_CONFIG.STATIC_UA
  });
  if (resp.status < 200 || resp.status >= 300) throw Object.assign(new Error(`HTTP ${resp.status}`), { code: "ERR_HTTP_STATUS", status: resp.status });
  const finalUrl = resp.finalUrl;
  const html = resp.body;
  const $ = cheerio.load(html);

  const schemaObjects = parseJsonLdBlocks(
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
    canonicalHref: $('link[rel="canonical"]').attr("href") || "",
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
      linkCount: pageLinks.length,
      internalLinkCount: pageLinks.filter(href => {
        try { return new URL(href, finalUrl).origin === new URL(finalUrl).origin; } catch { return false; }
      }).length,
      externalLinkCount: pageLinks.filter(href => {
        try { return new URL(href, finalUrl).origin !== new URL(finalUrl).origin; } catch { return false; }
      }).length
    }
  };
}

/* ============================================================
   RENDERED CRAWL (INTENT ONLY — NO SCORING DATA)
============================================================ */
export async function renderedIntentProbe(url) {
  const validated = validateTarget(url);
  if (!validated.ok) throw Object.assign(new Error(validated.error), { code: "ERR_INVALID_TARGET" });
  return {
    mode: "rendered",
    status: "not_run",
    reason: "Rendered collection is disabled until network isolation and policy controls are verified. User-agent imitation is not provider verification."
  };
}

export async function crawlPage({ url, mode = "static" }) {
  if (mode !== "static") return renderedIntentProbe(url);
  return staticCrawl(url);
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
