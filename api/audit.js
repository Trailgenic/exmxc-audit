// /api/audit.js — EEI v3.0 Modular Entity Audit (Verified Clean ASCII)

import axios from "axios";
import * as cheerio from "cheerio";
import {
  scoreMetaLayer,
  scoreSchemaLayer,
  scoreGraphLayer,
  scoreTrustLayer,
  scoreAILayer,
  combineScores
} from "../shared/scoring.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/3.0 Safari/537.36";

function normalizeUrl(input) {
  let url = (input || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const u = new URL(url);
    if (!u.pathname) u.pathname = "/";
    return u.toString();
  } catch {
    return null;
  }
}

function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function tryParseJSON(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function tierFromScore(score) {
  if (score >= 90) return "☀️ Sovereign Entity";
  if (score >= 70) return "🌕 Structured Entity";
  if (score >= 50) return "🌗 Visible Entity";
  if (score >= 30) return "🌑 Emergent Entity";
  return "Unstructured Entity";
}

export default async function handler(req, res) {
  const origin = req.headers.origin || req.headers.referer;
  let normalizedOrigin = "*";
  if (origin && origin !== "null") {
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      normalizedOrigin = "*";
    }
  }
  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (normalizedOrigin !== "*") res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();

  res.setHeader("Content-Type", "application/json");

  try {
    const input = req.query?.url;
    if (!input || typeof input !== "string" || !input.trim()) {
      return res.status(400).json({ error: "Missing URL" });
    }

    const normalized = normalizeUrl(input);
    if (!normalized) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const originHost = hostnameOf(normalized);
    let html = "";
    try {
      const resp = await axios.get(normalized, {
        timeout: 15000,
        maxRedirects: 5,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml"
        },
        validateStatus: (s) => s >= 200 && s < 400
      });
      html = resp.data || "";
    } catch (e) {
      return res.status(500).json({
        error: "Failed to fetch URL",
        details: e?.message || "Request blocked or timed out",
        url: normalized
      });
    }

    const $ = cheerio.load(html);
    const ldBlocks = $("script[type='application/ld+json']")
      .map((_, el) => $(el).contents().text())
      .get();
    const schemaObjects = ldBlocks.flatMap(tryParseJSON);
    const pageLinks = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean);

    const metaScores = scoreMetaLayer($, normalized);
    const schemaScores = scoreSchemaLayer(schemaObjects, pageLinks);
    const graphScores = scoreGraphLayer($, originHost);
    const trustScores = scoreTrustLayer($);
    const aiScores = scoreAILayer($, schemaObjects);

    const { total: entityScore, breakdown } = combineScores([
      metaScores,
      schemaScores,
      graphScores,
      trustScores,
      aiScores
    ]);

    const entityTier = tierFromScore(entityScore);

    const title = $("title").first().text().trim();
    const entityName =
      schemaObjects.find((o) => o["@type"] === "Organization" && o.name)?.name ||
      schemaObjects.find((o) => o["@type"] === "Person" && o.name)?.name ||
      (title.includes(" | ") ? title.split(" | ")[0] : title.split(" - ")[0]);

    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    const canonical =
      $('link[rel="canonical"]').attr("href") || normalized.replace(/\/$/, "");

    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: originHost,
      entityName: (entityName || "").trim(),
      entityScore: Math.round(entityScore),
      entityTier,
      signals: breakdown,
      schemaMeta: { schemaBlocks: schemaObjects.length },
      description,
      canonical,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("EEI Audit Error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message || String(err)
    });
  }
}
