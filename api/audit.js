// /api/audit.js — FINAL EEI v5 (standalone, no V4 dependency)

import { tierFromScore } from "../shared/scoring.js";

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeOrigin(req, res) {
  const origin = req.headers.origin || req.headers.referer;
  let normalized = "*";

  try {
    if (origin && origin !== "null") {
      normalized = new URL(origin).origin;
    }
  } catch {
    normalized = "*";
  }

  res.setHeader("Access-Control-Allow-Origin", normalized);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (normalized !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

/* -------------------------------------------------------
   V5 Weights
------------------------------------------------------- */

const V5_SIGNAL_WEIGHTS = {
  "Title Precision": 3,
  "Meta Description Integrity": 3,
  "Canonical Clarity": 2,
  "Brand & Technical Consistency": 2,

  "Schema Presence & Validity": 10,
  "Organization Schema": 8,
  "Breadcrumb Schema": 7,
  "Author/Person Schema": 5,

  "Social Entity Links": 5,
  "Internal Lattice Integrity": 20,
  "External Authority Signal": 15,
  "AI Crawl Fidelity": 10,
  "Inference Efficiency": 15
};

const V5_TIER_MAP = {
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

const V5_TIER_LABELS = {
  tier1: "Entity comprehension & trust",
  tier2: "Structural data fidelity",
  tier3: "Page-level hygiene"
};

const TOTAL_V5_WEIGHT = Object.values(V5_SIGNAL_WEIGHTS).reduce(
  (s, w) => s + w,
  0
);

/* -------------------------------------------------------
   Minimal Standalone Crawler (V5 only)
   Uses global fetch (Node 18 / Vercel)
------------------------------------------------------- */

async function crawlURL(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; exmxc-eei/1.0; +https://exmxc.ai)"
    }
  });

  if (!response.ok) {
    throw new Error(`Upstream fetch failed with status ${response.status}`);
  }

  const html = await response.text();

  return {
    url,
    hostname: new URL(url).hostname,
    html
  };
}

/* -------------------------------------------------------
   Simple Signal Extractors (HTML → signal points)
------------------------------------------------------- */

function extractSignals(html) {
  const signals = [];

  function get(tag, prop) {
    const regex = new RegExp(`<${tag}[^>]*${prop}="([^"]+)"`, "i");
    const m = html.match(regex);
    return m ? m[1] : "";
  }

  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
  const desc = get("meta", 'name="description"');
  const canonical = get("link", 'rel="canonical"');

  const hasOrg = html.includes('"@type":"Organization"');
  const hasBreadcrumb = html.includes('"BreadcrumbList"');
  const hasAuthor = html.includes('"@type":"Person"');

  signals.push({
    key: "Title Precision",
    points: title ? 3 : 0,
    max: 3
  });

  signals.push({
    key: "Meta Description Integrity",
    points: desc ? 3 : 0,
    max: 3
  });

  signals.push({
    key: "Canonical Clarity",
    points: canonical ? 2 : 0,
    max: 2
  });

  signals.push({
    key: "Schema Presence & Validity",
    points: html.includes("@context") ? 10 : 0,
    max: 10
  });

  signals.push({
    key: "Organization Schema",
    points: hasOrg ? 8 : 0,
    max: 8
  });

  signals.push({
    key: "Breadcrumb Schema",
    points: hasBreadcrumb ? 7 : 0,
    max: 7
  });

  signals.push({
    key: "Author/Person Schema",
    points: hasAuthor ? 5 : 0,
    max: 5
  });

  // Basic placeholders for now
  signals.push({ key: "Social Entity Links", points: 0, max: 5 });
  signals.push({ key: "Internal Lattice Integrity", points: 0, max: 20 });
  signals.push({ key: "External Authority Signal", points: 0, max: 15 });
  signals.push({ key: "AI Crawl Fidelity", points: 5, max: 10 });
  signals.push({ key: "Inference Efficiency", points: 10, max: 15 });

  return signals;
}

/* -------------------------------------------------------
   MAIN HANDLER — FINAL EEI v5
------------------------------------------------------- */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    normalizeOrigin(req, res);
    return res.status(200).end();
  }

  normalizeOrigin(req, res);
  res.setHeader("Content-Type", "application/json");

  try {
    const input = req.query?.url;
    if (!input) {
      return res.status(400).json({ error: "Missing URL" });
    }

    const url = input.startsWith("http") ? input : `https://${input}`;

    const crawled = await crawlURL(url);
    const signals = extractSignals(crawled.html);

    const signalsByKey = {};
    signals.forEach((s) => (signalsByKey[s.key] = s));

    let total = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

    for (const [key, weight] of Object.entries(V5_SIGNAL_WEIGHTS)) {
      const s = signalsByKey[key];
      const strength = s?.max ? (s.points / s.max) : 0;
      const contrib = strength * weight;

      total += contrib;

      const tier = V5_TIER_MAP[key] || "tier3";
      tierRaw[tier] += contrib;
      tierMax[tier] += weight;
    }

    const scale = 100 / TOTAL_V5_WEIGHT;
    const v5Score = clamp(Math.round(total * scale), 0, 100);

    const v5Tier = tierFromScore(v5Score);

    return res.status(200).json({
      success: true,
      mode: "EEI v5 (standalone)",
      url,
      hostname: crawled.hostname,
      v5Score,
      v5Stage: v5Tier.stage,
      v5Verb: v5Tier.verb,
      v5Description: v5Tier.description,
      v5Focus: v5Tier.coreFocus,
      signals,
      timestamp: new Date().toISOString(),

      // 🔁 Backwards-compat for existing UI (entityScore, etc.)
      entityScore: v5Score,
      entityStage: v5Tier.stage,
      entityVerb: v5Tier.verb,
      entityDescription: v5Tier.description,
      entityFocus: v5Tier.coreFocus
    });
  } catch (err) {
    console.error("EEI v5 error:", err);
    return res.status(500).json({
      error: "Internal EEI v5 error",
      details: err.message || String(err)
    });
  }
}
