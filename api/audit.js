// EEI v7 — Stable Merge Build
// 1) State = blocked | defensive | open
// 2) ECC Score (0–100)
// 3) Tier1 / Tier2 / Tier3 scoring preserved

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
  tierFromScore
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";

/* ---------------- Helpers ---------------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeUrl(input) {
  let u = (input || "").trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/* ----------- Tier Mapping (unchanged) ----------- */

const SIGNAL_TIER = {
  "Title Precision": "tier3",
  "Meta Description Integrity": "tier3",
  "Canonical Clarity": "tier3",
  "Brand & Technical Consistency": "tier3",

  "Schema Presence & Validity": "tier2",
  "Organization Schema": "tier2",
  "Breadcrumb Schema": "tier2",
  "Author/Person Schema": "tier2",

  "Social Entity Links": "tier1",
  "Internal Lattice Integrity": "tier1",
  "External Authority Signal": "tier1",
  "AI Crawl Fidelity": "tier1",
  "Inference Efficiency": "tier1"
};

const TIER_LABELS = {
  tier1: "Entity comprehension & trust",
  tier2: "Structural data fidelity",
  tier3: "Page-level hygiene"
};

/* ----------- STATIC CRAWL ONLY (safe + fast) ----------- */

async function staticCrawl(url) {
  const resp = await axios.get(url, {
    timeout: 7000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; exmxc-eei/7; +https://exmxc.ai)",
      Accept: "text/html"
    }
  });

  const html = resp.data || "";
  const $ = cheerio.load(html);

  const schemaObjects = $('script[type="application/ld+json"]')
    .map((_, el) => {
      try {
        const json = JSON.parse($(el).text());
        if (Array.isArray(json)) return json;
        if (json["@graph"]) return json["@graph"];
        return [json];
      } catch {
        return [];
      }
    })
    .get()
    .flat();

  const pageLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  return {
    status: resp.status,
    headers: resp.headers,
    html,
    $,
    schemaObjects,
    pageLinks
  };
}

/* --------------- CLASSIFY STATE ----------------
   BLOCKED    = access denied / captcha / 401/403/429
   DEFENSIVE  = bot protection / anti-scrape but content loads
   OPEN       = normal crawlable site
-------------------------------------------------- */

function classifyState(status, htmlTextLower) {
  if ([401, 403].includes(status)) return "blocked";

  if (
    status === 429 ||
    htmlTextLower.includes("captcha") ||
    htmlTextLower.includes("access denied") ||
    htmlTextLower.includes("verify you are human") ||
    htmlTextLower.includes("datadome") ||
    htmlTextLower.includes("perimeterx") ||
    htmlTextLower.includes("akamai")
  ) {
    return "defensive";
  }

  return "open";
}

/* ----------------- MAIN HANDLER ----------------- */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const input = req.query?.url;
    if (!input) return res.status(400).json({ error: "Missing URL" });

    const url = normalizeUrl(input);
    const host = hostnameOf(url);

    /* ---- STATIC FETCH ---- */
    let crawl;
    let blocked = false;

    try {
      crawl = await staticCrawl(url);
    } catch {
      blocked = true;
      crawl = { html: "", schemaObjects: [], pageLinks: [], status: 0 };
    }

    const htmlLower = (crawl.html || "").toLowerCase();
    const state = blocked
      ? "blocked"
      : classifyState(crawl.status, htmlLower);

    /* ---- ECC SCORING (still works even if defensive) ---- */
    const $ = crawl.$ || cheerio.load("");

    const results = [
      scoreTitle($),
      scoreMetaDescription($),
      scoreCanonical($, url),
      scoreSchemaPresence(crawl.schemaObjects),
      scoreOrgSchema(crawl.schemaObjects),
      scoreBreadcrumbSchema(crawl.schemaObjects),
      scoreAuthorPerson(crawl.schemaObjects, $),
      scoreSocialLinks(crawl.schemaObjects, crawl.pageLinks),
      scoreAICrawlSignals($),
      scoreContentDepth($),
      scoreInternalLinks(crawl.pageLinks, host),
      scoreExternalLinks(crawl.pageLinks, host),
      scoreFaviconOg($)
    ];

    let totalRaw = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

    for (const sig of results) {
      const safe = clamp(sig.points || 0, 0, sig.max);
      const tier = SIGNAL_TIER[sig.key] || "tier3";
      totalRaw += safe;
      tierRaw[tier] += safe;
      tierMax[tier] += sig.max;
    }

    const eccScore = blocked
      ? 0
      : clamp(Math.round((totalRaw * 100) / TOTAL_WEIGHT), 0, 100);

    const tierScores = {
      tier1: {
        label: TIER_LABELS.tier1,
        raw: tierRaw.tier1,
        maxWeight: tierMax.tier1,
        normalized:
          tierMax.tier1 > 0
            ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2))
            : 0
      },
      tier2: {
        label: TIER_LABELS.tier2,
        raw: tierRaw.tier2,
        maxWeight: tierMax.tier2,
        normalized:
          tierMax.tier2 > 0
            ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2))
            : 0
      },
      tier3: {
        label: TIER_LABELS.tier3,
        raw: tierRaw.tier3,
        maxWeight: tierMax.tier3,
        normalized:
          tierMax.tier3 > 0
            ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2))
            : 0
      }
    };

    const scoringBars = results.map(r => ({
      key: r.key,
      points: r.points,
      max: r.max,
      percent: r.max ? Math.round((r.points / r.max) * 100) : 0,
      notes: r.notes
    }));

    return res.status(200).json({
      success: true,
      url,
      hostname: host,

      state,              // <-- Blocked / Defensive / Open
      ecc: { score: eccScore, max: 100 },

      tierScores,         // <-- Tier1 / Tier2 / Tier3
      scoringBars,        // <-- UX-safe breakdown
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Internal error"
    });
  }
}
