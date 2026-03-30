// /api/ai-jobs-signal.js
// AI Jobs Signal — ADS scorer + MCP signal detector

import axios from "axios";
import * as cheerio from "cheerio";
import {
  classifyPostings,
  computeADS,
  assignQuadrant
} from "../shared/ads-classifier.js";
import baseline from "../shared/ads-baseline.json" with { type: "json" };
import { TIER_KEYWORDS } from "../shared/ads-taxonomy.js";

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeMode(value) {
  const mode = String(value || "signal").toLowerCase();
  if (["signal", "benchmark", "compare"].includes(mode)) return mode;
  return "signal";
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function allTaxonomyKeywords() {
  const terms = [];

  for (const tier of Object.values(TIER_KEYWORDS)) {
    for (const role of tier.roles || []) terms.push(role);
    for (const skill of tier.skills || []) terms.push(skill);
  }

  return Array.from(new Set(terms.map(v => String(v).toLowerCase())));
}

function extractCompany(sourceText, descriptionText) {
  const source = String(sourceText || "").trim();
  if (source) return source;

  const desc = String(descriptionText || "");
  const match = desc.match(/company\s*[:\-]\s*([^\n\r<]+)/i);
  if (match?.[1]) return match[1].trim();

  return "Unknown";
}

function extractSkills(descriptionText, keywords) {
  const text = String(descriptionText || "").toLowerCase();
  if (!text) return [];

  const hits = keywords.filter(term => text.includes(term));
  return Array.from(new Set(hits)).slice(0, 20);
}

function buildTierDistribution(classified = []) {
  const out = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };

  for (const item of classified) {
    const tier = Number(item?.tier || 1);
    if (tier === 5) out.t5 += 1;
    else if (tier === 4) out.t4 += 1;
    else if (tier === 3) out.t3 += 1;
    else if (tier === 2) out.t2 += 1;
    else out.t1 += 1;
  }

  return out;
}

function dominantTierLabel(dist) {
  const pairs = [
    ["T1", Number(dist?.t1 || 0)],
    ["T2", Number(dist?.t2 || 0)],
    ["T3", Number(dist?.t3 || 0)],
    ["T4", Number(dist?.t4 || 0)],
    ["T5", Number(dist?.t5 || 0)]
  ];

  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0]?.[0] || "T1";
}

function describeTierShift(distribution) {
  const current = dominantTierLabel(distribution);
  const baselineCenter = String(baseline?.market_metrics?.center_of_gravity || "T3-T4");

  if (baselineCenter.includes(current)) {
    return `Aligned with baseline center of gravity (${baselineCenter}).`;
  }

  if (["T4", "T5"].includes(current)) {
    return `Shifted above baseline center of gravity (${baselineCenter}) toward ${current}.`;
  }

  return `Shifted below baseline center of gravity (${baselineCenter}) toward ${current}.`;
}

async function fetchIndeedPostings(query, count) {
  const url = `https://www.indeed.com/rss?q=${encodeURIComponent(query)}&l=remote&limit=${count}`;
  const resp = await axios.get(url, {
    timeout: 15000,
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; exmxc-ai-jobs-signal/1.0; +https://exmxc.ai)"
    }
  });

  const $ = cheerio.load(String(resp.data || ""), { xmlMode: true });
  const keywords = allTaxonomyKeywords();

  const postings = [];
  $("item").each((idx, el) => {
    if (idx >= count) return;

    const title = $(el).find("title").first().text().trim();
    const guid = $(el).find("guid").first().text().trim() || `posting-${idx + 1}`;
    const source = $(el).find("source").first().text().trim();
    const description = $(el).find("description").first().text();

    postings.push({
      posting_id: guid,
      title,
      company: extractCompany(source, description),
      skills_raw: extractSkills(description, keywords)
    });
  });

  return postings;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const mode = normalizeMode(req.query?.mode);

    if (mode === "benchmark") {
      return res.status(200).json(baseline);
    }

    const query = String(req.query?.query || "").trim();
    const count = parsePositiveInt(req.query?.count, 20);

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Missing required query parameter: query"
      });
    }

    const postings = await fetchIndeedPostings(query, count);
    const classified = await classifyPostings(postings);
    const scoring = computeADS(classified, postings.length, 0);

    if (!scoring) {
      return res.status(200).json({
        tool: "ai-jobs-signal",
        version: "1.0",
        query,
        period: currentPeriod(),
        generated_at: new Date().toISOString(),
        sample_size: postings.length,
        scoring: null,
        tier_distribution: { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 },
        top_postings: [],
        benchmark_delta: {
          ads_vs_baseline: null,
          mcp_vs_baseline: null,
          tier_shift: "Insufficient classification output to compute shift."
        },
        methodology: "https://exmxc.ai/frameworks/ads"
      });
    }

    const byId = new Map(postings.map(p => [String(p.posting_id), p]));
    const merged = classified.map(item => {
      const posting = byId.get(String(item.posting_id)) || {};
      return {
        posting_id: String(item.posting_id || ""),
        title: String(posting.title || ""),
        company: String(posting.company || "Unknown"),
        tier: Number(item.tier || 1),
        mcp_signal: Boolean(item.mcp_signal),
        deployment_signal: Boolean(item.deployment_signal),
        exploration_signal: Boolean(item.exploration_signal),
        leadership: Boolean(item.leadership),
        confidence: Number(item.confidence || 0)
      };
    });

    const tierDistribution = buildTierDistribution(merged);
    const adsVsBaseline = Number((Number(scoring.ads_score) - Number(baseline?.market_metrics?.avg_ads_score || 0)).toFixed(1));
    const mcpVsBaseline = Number((Number(scoring.mcp_signal_count) - Number(baseline?.market_metrics?.mcp_signal_count || 0)).toFixed(1));

    const payload = {
      tool: "ai-jobs-signal",
      version: "1.0",
      query,
      period: currentPeriod(),
      generated_at: new Date().toISOString(),
      sample_size: postings.length,
      scoring,
      tier_distribution: tierDistribution,
      top_postings: merged.slice(0, 10),
      benchmark_delta: {
        ads_vs_baseline: adsVsBaseline,
        mcp_vs_baseline: mcpVsBaseline,
        tier_shift: describeTierShift(tierDistribution)
      },
      methodology: "https://exmxc.ai/frameworks/ads"
    };

    const ariScore = Number(req.query?.ari_score || 0);
    payload.positioning = assignQuadrant(ariScore, scoring);

    if (mode === "compare") {
      payload.baseline = baseline;
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "AI jobs signal failed"
    });
  }
}
