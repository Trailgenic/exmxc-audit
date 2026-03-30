// /shared/ads-classifier.js
// ADS classification + scoring helpers

import axios from "axios";
import {
  TIER_KEYWORDS,
  DEPLOYMENT_SIGNALS,
  EXPLORATION_SIGNALS,
  LEADERSHIP_SIGNALS
} from "./ads-taxonomy.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

function round1(value) {
  return Number(Number(value).toFixed(1));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildSystemPrompt() {
  return [
    "You are an AI jobs classifier for an ADS (AI Deployment Signal) scoring framework.",
    "Return ONLY valid JSON. No markdown. No backticks. No commentary.",
    "Return format exactly:",
    '{"classified":[{"posting_id":"string","tier":1,"mcp_signal":false,"deployment_signal":true,"exploration_signal":false,"leadership":false,"confidence":0.9}]}',
    "Classification rules:",
    "- T1 = strategy/governance/literacy/policy roles.",
    "- T2 = data scientist/RAG/embeddings/LangChain.",
    "- T3 = ML/LLM Engineer/MLOps/model deployment.",
    "- T4 = AI agent/multi-agent/LangGraph/CrewAI/tool use/function calling.",
    "- T4+MCP = any role requiring MCP/Model Context Protocol (set mcp_signal=true).",
    "- T5 = foundation model/RLHF/pre-training/custom silicon.",
    "- deployment_signal=true if title contains engineer/infra/platform/systems/architect/developer.",
    "- exploration_signal=true if title contains strategy/transformation/governance/policy/literacy.",
    "- leadership=true if title contains head of/director/vp/principal/staff/distinguished.",
    "Confidence must be a number from 0.0 to 1.0.",
    "Classify every posting in input."
  ].join("\n");
}

function extractJsonBlock(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export async function classifyPostings(postings) {
  if (!Array.isArray(postings) || postings.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await axios.post(
      ANTHROPIC_URL,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        system: buildSystemPrompt(),
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              postings: postings.map(p => ({
                posting_id: String(p?.posting_id || ""),
                title: String(p?.title || ""),
                skills_raw: Array.isArray(p?.skills_raw) ? p.skills_raw : []
              })),
              keyword_hints: TIER_KEYWORDS
            })
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

    const content = response?.data?.content;
    const text = Array.isArray(content)
      ? content.map(item => item?.text || "").join("\n")
      : "";

    const parsed = extractJsonBlock(text);
    const classified = Array.isArray(parsed?.classified) ? parsed.classified : [];

    return classified.map(item => ({
      posting_id: String(item?.posting_id || ""),
      tier: clamp(Number(item?.tier || 1), 1, 5),
      mcp_signal: Boolean(item?.mcp_signal),
      deployment_signal: Boolean(item?.deployment_signal),
      exploration_signal: Boolean(item?.exploration_signal),
      leadership: Boolean(item?.leadership),
      confidence: clamp(Number(item?.confidence || 0), 0, 1)
    }));
  } catch {
    return [];
  }
}

export function computeADS(classified, currentCount, priorCount) {
  if (!Array.isArray(classified) || classified.length === 0) return null;

  const tierWeights = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6 };

  let weightedSum = 0;
  let deployCount = 0;
  let exploreCount = 0;
  let mcpSignalCount = 0;

  for (const item of classified) {
    const tier = clamp(Number(item?.tier || 1), 1, 5);
    let weight = Number(tierWeights[tier] || 1);

    if (item?.mcp_signal) {
      weight *= 1.5;
      mcpSignalCount += 1;
    }

    if (item?.leadership) {
      weight *= 1.2;
    }

    if (item?.deployment_signal) deployCount += 1;
    if (item?.exploration_signal) exploreCount += 1;

    weightedSum += weight;
  }

  const weightedAvgRaw = weightedSum / classified.length;
  const rsi = ((weightedAvgRaw - 1) / (6 - 1)) * 100;

  const denom = deployCount + exploreCount;
  const der = denom > 0 ? deployCount / denom : 0.5;

  let vs = 50;
  if (Number(priorCount) > 0) {
    const rawVS = ((Number(currentCount) - Number(priorCount)) / Number(priorCount)) * 100;
    vs = (clamp(rawVS, -100, 100) + 100) / 2;
  }

  const adsScore = (rsi * 0.4) + (der * 100 * 0.35) + (vs * 0.25);

  let adsTier = 1;
  if (adsScore >= 86) adsTier = 5;
  else if (adsScore >= 61) adsTier = 4;
  else if (adsScore >= 41) adsTier = 3;
  else if (adsScore >= 21) adsTier = 2;

  return {
    rsi: round1(rsi),
    der: round1(der),
    vs: round1(vs),
    ads_score: round1(adsScore),
    ads_tier: adsTier,
    mcp_signal_count: round1(mcpSignalCount),
    mcp_weight_applied: round1(mcpSignalCount > 0 ? 1.5 : 1.0)
  };
}

export function assignQuadrant(ari_score, scoring) {
  const ari = Number(ari_score || 0);
  const ads = Number(scoring?.ads_score || 0);
  const der = Number(scoring?.der || 0.5);

  const ariHigh = ari >= 60;
  const adsHigh = ads >= 60;
  const inflationRisk = ariHigh && !adsHigh && der < 0.4;

  let position = "confirmed_laggard";
  let narrative = "Low ARI and low ADS indicate weak adoption momentum and low operational deployment depth.";

  if (ariHigh && adsHigh) {
    position = "confirmed_leader";
    narrative = "High ARI and high ADS indicate visible authority with validated workforce deployment depth.";
  } else if (!ariHigh && adsHigh) {
    position = "hidden_mover";
    narrative = "ADS outperforms ARI, suggesting practical deployment momentum ahead of external market perception.";
  } else if (inflationRisk) {
    position = "ari_inflation_risk";
    narrative = "High ARI but low ADS with weak DER suggests narrative strength without enough deployment-backed staffing signals.";
  }

  return {
    position,
    ari_inflation_risk: inflationRisk,
    narrative
  };
}
