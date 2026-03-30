// /api/ai-jobs-signal.js
// AI Jobs Signal — synthetic market sample + ADS scoring

import axios from "axios";
import {
  classifyPostings,
  computeADS,
  assignQuadrant
} from "../shared/ads-classifier.js";
import baseline from "../shared/ads-baseline.json" assert { type: "json" };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const METHODOLOGY_URL = "https://exmxc.ai/frameworks/ads";

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function resolveMode(rawMode, query) {
  const mode = String(rawMode || "").toLowerCase();
  if (["benchmark", "signal", "compare"].includes(mode)) return mode;
  return String(query || "").trim() ? "signal" : "benchmark";
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function extractJsonArray(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

async function generateSyntheticPostings(query, count) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const systemPrompt = [
    "You are a job market research assistant with deep knowledge of the",
    "US AI/ML hiring market as of early 2026. Generate a realistic sample",
    "of current remote US AI job postings matching the search query.",
    "Return ONLY a valid JSON array, no markdown, no preamble:",
    "[",
    "  {",
    "    \"posting_id\": \"synthetic-001\",",
    "    \"title\": \"string\",",
    "    \"company\": \"string\",",
    "    \"location\": \"Remote\",",
    "    \"skills_raw\": [\"skill1\", \"skill2\"],",
    "    \"posted_date\": \"2026-03\",",
    "    \"compensation\": \"$120,000 - $180,000\"",
    "  }",
    "]",
    "Base postings on real market patterns. Include a realistic mix of",
    "seniority levels and company types."
  ].join("\n");

  try {
    const response = await axios.post(
      ANTHROPIC_URL,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Generate ${count} AI job postings for search query: ${query}`
          }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        timeout: 20000
      }
    );

    const content = Array.isArray(response?.data?.content)
      ? response.data.content.map(item => item?.text || "").join("\n")
      : "";

    const postings = extractJsonArray(content);

    return postings.map((post, idx) => ({
      posting_id: String(post?.posting_id || `synthetic-${String(idx + 1).padStart(3, "0")}`),
      title: String(post?.title || ""),
      company: String(post?.company || "Unknown"),
      location: String(post?.location || "Remote"),
      skills_raw: Array.isArray(post?.skills_raw) ? post.skills_raw.map(s => String(s)) : [],
      posted_date: String(post?.posted_date || currentPeriod()),
      compensation: String(post?.compensation || "")
    }));
  } catch {
    return [];
  }
}

function tierDistributionFromClassified(classified = []) {
  const dist = {
    t1_awareness: 0,
    t2_experimentation: 0,
    t3_integration: 0,
    t4_agentic: 0,
    t5_sovereign: 0
  };

  for (const row of classified) {
    const tier = Number(row?.tier || 1);
    if (tier >= 5) dist.t5_sovereign += 1;
    else if (tier === 4) dist.t4_agentic += 1;
    else if (tier === 3) dist.t3_integration += 1;
    else if (tier === 2) dist.t2_experimentation += 1;
    else dist.t1_awareness += 1;
  }

  return dist;
}

function averageTierFromDistribution(dist) {
  const weighted =
    (dist.t1_awareness * 1) +
    (dist.t2_experimentation * 2) +
    (dist.t3_integration * 3) +
    (dist.t4_agentic * 4) +
    (dist.t5_sovereign * 5);

  const total =
    dist.t1_awareness +
    dist.t2_experimentation +
    dist.t3_integration +
    dist.t4_agentic +
    dist.t5_sovereign;

  if (total <= 0) return 0;
  return weighted / total;
}

function buildBenchmarkDelta(scoring, tierDistribution) {
  const currentTierAverage = averageTierFromDistribution(tierDistribution);
  const tierShift = currentTierAverage > 3
    ? "Shift toward higher deployment tiers vs March 2026 baseline"
    : "Consistent with March 2026 baseline";

  return {
    ads_vs_baseline: Number((Number(scoring?.ads_score || 0) - Number(baseline?.market_metrics?.avg_ads_score || 0)).toFixed(1)),
    mcp_vs_baseline: Number((Number(scoring?.mcp_signal_count || 0) - Number(baseline?.market_metrics?.mcp_signal_count || 0)).toFixed(1)),
    tier_shift: tierShift
  };
}

function mergeTopPostings(postings, classified) {
  const byId = new Map(classified.map(item => [String(item?.posting_id || ""), item]));

  return postings.slice(0, 10).map(post => {
    const matched = byId.get(String(post.posting_id)) || {};
    return {
      ...post,
      tier: Number(matched?.tier || 1),
      mcp_signal: Boolean(matched?.mcp_signal),
      deployment_signal: Boolean(matched?.deployment_signal),
      exploration_signal: Boolean(matched?.exploration_signal),
      leadership: Boolean(matched?.leadership),
      confidence: Number(matched?.confidence || 0)
    };
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const query = String(req.query?.query || "").trim();
    const count = parsePositiveInt(req.query?.count, 20);
    const mode = resolveMode(req.query?.mode, query);

    if (mode === "benchmark") {
      return res.status(200).json({
        tool: "ai-jobs-signal",
        version: "1.0",
        mode: "benchmark",
        generated_at: new Date().toISOString(),
        methodology: METHODOLOGY_URL,
        data: baseline
      });
    }

    const postings = await generateSyntheticPostings(query, count);
    const classified = await classifyPostings(postings);
    const scoring = computeADS(classified, postings.length, 0);

    const safeScoring = scoring || {
      rsi: 0,
      der: 0.5,
      vs: 50,
      ads_score: 0,
      ads_tier: 1,
      mcp_signal_count: 0,
      mcp_weight_applied: 1
    };

    const tierDistribution = tierDistributionFromClassified(classified);

    const response = {
      tool: "ai-jobs-signal",
      version: "1.0",
      mode: mode === "compare" ? "compare" : "signal",
      query,
      period: currentPeriod(),
      generated_at: new Date().toISOString(),
      data_source: "claude-synthetic",
      sample_size: postings.length,
      scoring: safeScoring,
      tier_distribution: tierDistribution,
      top_postings: mergeTopPostings(postings, classified),
      benchmark_delta: buildBenchmarkDelta(safeScoring, tierDistribution),
      methodology: METHODOLOGY_URL
    };

    const ariScore = Number(req.query?.ari_score || 0);
    response.positioning = assignQuadrant(ariScore, safeScoring);

    if (mode === "compare") {
      response.baseline = baseline;
    }

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "AI jobs signal failed"
    });
  }
}

// FUTURE: Live Indeed data via Publisher API
// Requires: process.env.INDEED_PUBLISHER_ID
// Replace synthetic generation step with:
// GET https://api.indeed.com/ads/apisearch?publisher={id}&q={query}&l=remote&format=json
// Then feed results directly into classifyPostings()
