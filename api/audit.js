// /api/predictive-audit.js — Phase 3 Predictive EEI Engine
import axios from "axios";
import * as cheerio from "cheerio";
import { CURRENT_WEIGHTS, FUTURE_WEIGHTS } from "../shared/weights.js";
import { normalizeUrl, hostnameOf, tryParseJSON, clamp } from "../shared/scoring.js";

/* ================================
   CONFIG
   ================================ */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-predictive/3.0 Safari/537.36";

/* ================================
   CORE FUNCTION
   ================================ */

async function fetchAuditHTML(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error("Invalid URL");

  const resp = await axios.get(normalized, {
    timeout: 15000,
    maxRedirects: 5,
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return { normalized, html: resp.data };
}

function extractSignals(html, normalized) {
  const $ = cheerio.load(html);
  const pageLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);
  const ldBlocks = $("script[type='application/ld+json']")
    .map((_, el) => $(el).contents().text())
    .get();
  const schemaObjects = ldBlocks.flatMap(tryParseJSON);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  // baseline feature proxies (used for predictive model)
  const features = {
    hasOrgSchema: schemaObjects.some((o) => o["@type"]?.includes("Organization")),
    hasBreadcrumb: schemaObjects.some((o) => o["@type"]?.includes("BreadcrumbList")),
    hasPerson: schemaObjects.some((o) => o["@type"]?.includes("Person")),
    schemaBlocks: schemaObjects.length,
    internalLinks: pageLinks.filter((h) => hostnameOf(h) === hostnameOf(normalized)).length,
    externalLinks: pageLinks.filter((h) => hostnameOf(h) !== hostnameOf(normalized)).length,
    wordCount: text.split(" ").length,
  };
  return features;
}

/* ================================
   PROJECTIVE MODEL (Linear Regression Style)
   ================================ */

function computeEEI(features, weights) {
  let score = 0;
  for (const [key, w] of Object.entries(weights)) {
    let strength = 0;
    switch (key) {
      case "schemaPresence":
        strength = clamp(features.schemaBlocks / 2, 0, 1);
        break;
      case "orgSchema":
        strength = features.hasOrgSchema ? 1 : 0;
        break;
      case "breadcrumbSchema":
        strength = features.hasBreadcrumb ? 1 : 0;
        break;
      case "authorPerson":
        strength = features.hasPerson ? 1 : 0.5;
        break;
      case "internalLinks":
        strength = clamp(features.internalLinks / 10, 0, 1);
        break;
      case "externalLinks":
        strength = clamp(features.externalLinks / 5, 0, 1);
        break;
      case "contentDepth":
        strength =
          features.wordCount >= 1200 ? 1 : features.wordCount >= 300 ? 0.5 : 0.2;
        break;
      default:
        strength = 1; // for unscored misc weights
    }
    score += w * strength;
  }
  return clamp(score, 0, 100);
}

/* ================================
   MAIN HANDLER
   ================================ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const body = req.body || {};
    const urls =
      body.urls ||
      (req.query.url ? [req.query.url] : null);

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Missing URLs for predictive audit" });
    }

    const format = req.query.format || "json";
    const results = [];

    for (const rawUrl of urls) {
      try {
        const { normalized, html } = await fetchAuditHTML(rawUrl);
        const features = extractSignals(html, normalized);

        const eei_current = computeEEI(features, CURRENT_WEIGHTS);
        const eei_projected = computeEEI(features, FUTURE_WEIGHTS);
        const entity_resilience_score =
          eei_current > 0 ? clamp(eei_projected / eei_current, 0, 2) : 0;

        results.push({
          url: normalized,
          eei_current: Math.round(eei_current),
          eei_projected: Math.round(eei_projected),
          entity_resilience_score: Number(entity_resilience_score.toFixed(3)),
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        results.push({ url: rawUrl, error: err.message });
      }
    }

    // --- Optional CSV Output ---
    if (format === "csv") {
      const header = "url,eei_current,eei_projected,entity_resilience_score,timestamp";
      const lines = results.map((r) =>
        [r.url, r.eei_current, r.eei_projected, r.entity_resilience_score, r.timestamp]
          .map((v) => `"${v ?? ""}"`)
          .join(",")
      );
      res.setHeader("Content-Type", "text/csv");
      return res.status(200).send([header, ...lines].join("\n"));
    }

    return res.status(200).json({
      success: true,
      total: results.length,
      results,
    });
  } catch (err) {
    console.error("Predictive Audit Error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
