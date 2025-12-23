// /api/audit.js — EEI v6.4 (LOCKED)
// ECC = STATIC ONLY
// Intent = RENDERED ONLY (observed, not scored)
// POST + GET compatible
// Vercel-safe, batch-safe
// HARD TIMEOUT FIX APPLIED

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
  if (ecc === "medium" && intent === "high") return "🌱 Aspirational Challenger";
  if (ecc === "medium" && intent === "medium") return "⚖️ Cautious Optimizer";
  return "Unclassified";
}

/* ===============================
   HARD TIMEOUT WRAPPER (CRITICAL)
================================ */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("INTENT_TIMEOUT")), ms)
    ),
  ]);
}

/* ===============================
   JSON-LD PARSER
================================ */
function parseJsonLd(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed["@graph"]) return parsed["@graph"];
    return [parsed];
  } catch {
    return [];
  }
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
        "Mozilla/5.0 (compatible; exmxc-static/6.4; +https://exmxc.ai)",
      Accept: "text/html",
    },
  });

  const html = resp.data || "";
  const $ = cheerio.load(html);

  const schemaObjects = $('script[type="application/ld+json"]')
    .map((_, el) => parseJsonLd($(el).text()))
    .get()
    .flat();

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
    wordCount: bodyText ? bodyText.split(" ").length : 0,
  };
}

/* ===============================
   HANDLER
================================ */
export default async function handler(req, res) {
  try {
    // ---- INPUT NORMALIZATION ----
    let input =
      req.method === "POST"
        ? req.body?.url
        : req.query?.url;

    if (!input || typeof input !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing URL",
      });
    }

    const url = input.startsWith("http")
      ? input
      : `https://${input}`;

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
    for (const b of breakdown) {
      raw += clamp(b.points || 0, 0, b.max);
    }

    const eccScore = clamp(
      Math.round((raw * 100) / TOTAL_WEIGHT),
      0,
      100
    );

    const ecc = eccBand(eccScore);

  /* -------- INTENT DETECTION (STATIC + RENDERED) -------- */
let intent = "low";
const intentSignals = [];

// ---- STATIC TEXT AGGREGATE ----
const staticText = (
  staticData.title +
  " " +
  staticData.description +
  " " +
  staticData.html
).toLowerCase();

// ---- AI LANGUAGE SIGNALS (STATIC) ----
const AI_KEYWORDS = [
  "ai",
  "artificial intelligence",
  "llm",
  "large language model",
  "model",
  "agent",
  "assistant",
  "copilot",
  "autonomous",
  "machine learning",
  "neural",
  "reflective ai"
];

const staticHits = AI_KEYWORDS.filter(k =>
  staticText.includes(k)
);

if (staticHits.length >= 2) {
  intent = "high";
  intentSignals.push(
    `AI-forward language detected (static): ${staticHits.join(", ")}`
  );
}

// ---- EXPLICIT AI CRAWL / INTERFACE SIGNALS ----
if (
  staticText.includes("llms.txt") ||
  staticText.includes("ai-assist") ||
  staticText.includes("ai-powered") ||
  staticText.includes("ai search") ||
  staticText.includes("ai-first")
) {
  intent = "high";
  intentSignals.push("Explicit AI crawl / assist signaling detected");
}

// ---- BOT DEFENSE DETECTION (INTENT SUPPRESSION) ----
const BOT_DEFENSE_SIGNALS = [
  "akamai",
  "perimeterx",
  "datadome",
  "cloudflare",
  "bot management",
  "access denied",
  "verify you are human",
  "captcha"
];

const botDefenseHits = BOT_DEFENSE_SIGNALS.filter(s =>
  staticText.includes(s)
);

if (botDefenseHits.length > 0) {
  intent = "low";
  intentSignals.push(
    `Bot-defense detected: ${botDefenseHits.join(", ")}`
  );
}

// ---- RENDERED CONFIRMATION (NON-AUTHORITATIVE) ----
try {
  const rendered = await axios.post(
    `${RENDER_WORKER}/crawl`,
    { url },
    { timeout: 12000 } // HARD FAIL FAST
  );

  const renderedText = JSON.stringify(rendered.data || {}).toLowerCase();

  const renderedHits = AI_KEYWORDS.filter(k =>
    renderedText.includes(k)
  );

  // Rendered signals can CONFIRM intent, but never override bot defense
  if (
    renderedHits.length &&
    intent !== "high" &&
    botDefenseHits.length === 0
  ) {
    intent = "high";
    intentSignals.push(
      `AI posture confirmed via render: ${renderedHits.join(", ")}`
    );
  }

} catch {
  intentSignals.push("Rendered crawl skipped or blocked");
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
