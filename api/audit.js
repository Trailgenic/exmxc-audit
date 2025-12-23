// /api/audit.js — EEI v6.6 (LOCKED)
// ECC = STATIC ONLY (FAIL-FAST)
// Intent = OBSERVED (STATIC + RENDERED, NOT SCORED)
// POST + GET compatible
// Vercel-safe, batch-safe
// HARD FAIL-FAST STATIC + RENDER
// RAW DEBUG RESTORED (?debug=1)

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
  scoreFaviconOg
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";

/* ===============================
   CONFIG
================================ */
const RENDER_WORKER =
  "https://exmxc-crawl-worker-production.up.railway.app";

const STATIC_TIMEOUT_MS = 7000;
const RENDER_TIMEOUT_MS = 8000;

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
   STATIC CRAWL (FAIL-FAST)
================================ */
async function staticCrawl(url) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    STATIC_TIMEOUT_MS
  );

  try {
    const resp = await axios.get(url, {
      timeout: STATIC_TIMEOUT_MS,
      maxRedirects: 5,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; exmxc-static/6.6; +https://exmxc.ai)",
        Accept: "text/html"
      }
    });

    clearTimeout(timer);

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

    const bodyText = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim();

    return {
      ok: true,
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
      wordCount: bodyText ? bodyText.split(" ").length : 0
    };

  } catch {
    clearTimeout(timer);

    // ---- DEGRADED STATIC FALLBACK ----
    return {
      ok: false,
      html: "",
      title: "",
      description: "",
      canonicalHref: url,
      schemaObjects: [],
      pageLinks: [],
      wordCount: 0,
      error: "STATIC_CRAWL_BLOCKED"
    };
  }
}

/* ===============================
   HANDLER
================================ */
export default async function handler(req, res) {
  try {
    /* ---- INPUT ---- */
    const input =
      req.method === "POST"
        ? req.body?.url
        : req.query?.url;

    if (!input || typeof input !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing URL"
      });
    }

    const debug =
      req.query?.debug === "1" ||
      req.headers["x-eei-debug"] === "true";

    const url = input.startsWith("http")
      ? input
      : `https://${input}`;

    const host = new URL(url).hostname.replace(/^www\./, "");

    /* -------- STATIC (ECC) -------- */
    const staticData = await staticCrawl(url);

    let breakdown = [];
    let eccScore = 0;
    let ecc = "low";

    if (staticData.ok) {
      const $ = cheerio.load(staticData.html);

      breakdown = [
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
        scoreFaviconOg($)
      ];

      let raw = 0;
      for (const b of breakdown) {
        raw += clamp(b.points || 0, 0, b.max);
      }

      eccScore = clamp(
        Math.round((raw * 100) / TOTAL_WEIGHT),
        0,
        100
      );

      ecc = eccBand(eccScore);
    }

    /* ===============================
       INTENT DETECTION (OBSERVED)
    ================================ */
    let intent = "low";
    const intentSignals = [];

    const staticText = (
      staticData.title +
      " " +
      staticData.description +
      " " +
      staticData.html
    ).toLowerCase();

    const AI_KEYWORDS = [
      "ai",
      "artificial intelligence",
      "llm",
      "large language model",
      "agent",
      "assistant",
      "copilot",
      "autonomous",
      "ai search",
      "ai-first",
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

    if (
      staticText.includes("llms.txt") ||
      staticText.includes("ai-powered") ||
      staticText.includes("ai assist")
    ) {
      intent = "high";
      intentSignals.push("Explicit AI crawl / assist signaling detected");
    }

    const BOT_DEFENSE_SIGNALS = [
      "akamai",
      "perimeterx",
      "datadome",
      "cloudflare",
      "captcha",
      "verify you are human",
      "access denied"
    ];

    const botDefenseHits = BOT_DEFENSE_SIGNALS.filter(s =>
      staticText.includes(s)
    );

    if (botDefenseHits.length > 0 || !staticData.ok) {
      intent = "low";
      intentSignals.push(
        botDefenseHits.length
          ? `Bot-defense detected: ${botDefenseHits.join(", ")}`
          : "Static crawl blocked / timed out"
      );
    }

    /* ---- RENDERED CONFIRMATION (FAIL FAST) ---- */
    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        RENDER_TIMEOUT_MS
      );

      const rendered = await axios.post(
        `${RENDER_WORKER}/crawl`,
        { url },
        {
          timeout: RENDER_TIMEOUT_MS,
          signal: controller.signal
        }
      );

      clearTimeout(timer);

      const renderedText =
        JSON.stringify(rendered.data || {}).toLowerCase();

      const renderedHits = AI_KEYWORDS.filter(k =>
        renderedText.includes(k)
      );

      if (
        renderedHits.length &&
        intent !== "high" &&
        botDefenseHits.length === 0 &&
        staticData.ok
      ) {
        intent = "high";
        intentSignals.push(
          `AI posture confirmed via render: ${renderedHits.join(", ")}`
        );
      }

    } catch {
      intentSignals.push("Rendered crawl blocked / timed out");
    }

    /* -------- RESPONSE -------- */
    return res.status(200).json({
      success: true,
      url,
      hostname: host,

      ecc: {
        score: eccScore,
        band: ecc,
        max: 100
      },

      intent: {
        posture: intent,
        signals: intentSignals,
        observedFrom: ["static", "rendered"]
      },

      quadrant: quadrant(ecc, intent),
      breakdown,

      ...(debug && {
        raw: {
          staticOk: staticData.ok,
          intentSignals,
          botDefenseHits
        }
      }),

      timestamp: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Internal error"
    });
  }
}
