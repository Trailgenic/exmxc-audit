// /api/audit.js — EEI v6.1
// STATIC = ECC
// RENDERED (Railway) = Intent only
// Vercel-safe (no cross-function imports)

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
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";

/* ===============================
   CONFIG
================================ */
const RENDER_WORKER =
  "https://exmxc-crawl-worker-production.up.railway.app";

/* ===============================
   HELPERS
================================ */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function eccBand(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function quadrant(ecc, intent) {
  if (ecc === "high" && intent === "high") return "🚀 AI-First Leader";
  if (ecc === "high" && intent === "low") return "🏰 Sovereign / Defensive Power";
  if (ecc === "medium" && intent === "medium") return "⚖️ Cautious Optimizer";
  if (ecc === "low" && intent === "high") return "🌱 Aspirational Challenger";
  return "Unclassified";
}

/* ===============================
   STATIC CRAWL (ECC SOURCE)
================================ */
async function staticCrawl(url) {
  const resp = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; exmxc-static/6.1; +https://exmxc.ai)",
      Accept: "text/html",
    },
  });

  const html = resp.data || "";
  const $ = cheerio.load(html);

  const schemaObjects = $('script[type="application/ld+json"]')
    .map((_, el) => {
      try {
        return JSON.parse($(el).text());
      } catch {
        return null;
      }
    })
    .get()
    .flat()
    .filter(Boolean);

  const pageLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  return {
    html,
    title: $("title").first().text().trim(),
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",
    canonicalHref:
      $('link[rel="canonical"]').attr("href") || url,
    schemaObjects,
    pageLinks,
    wordCount: bodyText.split(" ").length,
  };
}

/* ===============================
   HANDLER
================================ */
export default async function handler(req, res) {
  try {
    const input = req.query?.url;
    if (!input) {
      return res.status(400).json({ success: false, error: "Missing URL" });
    }

    const url = input.startsWith("http") ? input : `https://${input}`;
    const host = new URL(url).hostname.replace(/^www\./, "");

    /* -------- STATIC (ECC) -------- */
    const staticData = await staticCrawl(url);
    const $ = cheerio.load(staticData.html);

    const breakdown = [
      scoreTitle($, staticData),
      scoreMetaDescription($, staticData),
      scoreCanonical($, url, staticData),
      scoreSchemaPresence(staticData.schemaObjects),
      scoreOrgSchema(staticData.schemaObjects),
      scoreBreadcrumbSchema(staticData.schemaObjects),
      scoreAuthorPerson(staticData.schemaObjects, $),
      scoreSocialLinks(staticData.schemaObjects, staticData.pageLinks),
      scoreAICrawlSignals($),
      scoreContentDepth($, staticData),
      scoreInternalLinks(staticData.pageLinks, host),
      scoreExternalLinks(staticData.pageLinks, host),
      scoreFaviconOg($),
    ];

    let raw = 0;
    breakdown.forEach(b => raw += clamp(b.points || 0, 0, b.max));

    const eccScore = clamp(
      Math.round((raw * 100) / TOTAL_WEIGHT),
      0,
      100
    );

    const ecc = eccBand(eccScore);

    /* -------- RENDERED (INTENT) -------- */
    let intent = "low";
    const intentSignals = [];

    try {
      const rendered = await axios.post(
        `${RENDER_WORKER}/crawl`,
        { url },
        { timeout: 25000 }
      );

      const renderedSchemas =
        rendered.data?.surfaces?.[0]?.schemaObjects || [];

      if (renderedSchemas.length > staticData.schemaObjects.length) {
        intent = "high";
        intentSignals.push("Additional schema exposed via JS rendering");
      }
    } catch {
      // Intent defaults to low
    }

    /* -------- RESPONSE -------- */
    return res.status(200).json({
      success: true,
      url,
      hostname: host,

      ecc: {
        score: eccScore,
        band: ecc,
        max: 100,
      },

      intent: {
        posture: intent,
        signals: intentSignals,
        observedFrom: ["static", "rendered"],
      },

      quadrant: quadrant(ecc, intent),
      breakdown,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Internal error",
    });
  }
}
