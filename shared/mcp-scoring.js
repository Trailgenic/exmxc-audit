// /shared/mcp-scoring.js
// MCP readiness scoring engine

import {
  MCP_BAND_THRESHOLDS,
  MCP_MAX_SCORE,
  MCP_PRIMARY_SIGNALS,
  MCP_SECONDARY_SIGNALS
} from "./mcp-signals.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function resolveBand(score) {
  if (score >= MCP_BAND_THRESHOLDS.mcpReady) return "mcp-ready";
  if (score >= MCP_BAND_THRESHOLDS.partiallyReady) return "partially-ready";
  if (score >= MCP_BAND_THRESHOLDS.emerging) return "emerging";
  return "not-ready";
}

function lineItem(label, points, max, notes, evidence = null) {
  return {
    key: label,
    points,
    max,
    notes,
    evidence
  };
}

export function calculateMcpScore(signals = {}) {
  const primary = signals.primary || {};
  const secondary = signals.secondary || {};

  const breakdown = [];
  let total = 0;

  for (const [key, cfg] of Object.entries(MCP_PRIMARY_SIGNALS)) {
    const sig = primary[key] || {};
    const detected = sig.detected === true;
    const valid = sig.valid === true;

    let points = 0;
    let notes = "Missing or invalid";

    if (detected && valid) {
      points = cfg.weight;
      notes = "Detected and schema-valid";
    }

    total += points;
    breakdown.push(lineItem(cfg.label, points, cfg.weight, notes, {
      status: sig.status ?? null,
      url: sig.url ?? null
    }));
  }

  for (const [key, cfg] of Object.entries(MCP_SECONDARY_SIGNALS)) {
    const sig = secondary[key] || {};
    const detected = sig.detected === true;

    let points = 0;
    let notes = "Not detected";

    if (key === "jsonEndpoints") {
      const count = Number(sig.count || 0);
      if (count >= 3) {
        points = cfg.weight;
        notes = "Multiple JSON endpoints detected";
      } else if (count >= 1) {
        points = Math.round(cfg.weight * 0.5);
        notes = "Some JSON endpoints detected";
      }
    } else if (key === "structuredData") {
      const count = Number(sig.jsonLdCount || 0);
      if (count >= 2) {
        points = cfg.weight;
        notes = "Strong structured data presence";
      } else if (count >= 1) {
        points = Math.round(cfg.weight * 0.5);
        notes = "Minimal structured data";
      }
    } else if (detected) {
      points = cfg.weight;
      notes = "Detected";
    }

    total += points;
    breakdown.push(lineItem(cfg.label, points, cfg.weight, notes, {
      count: sig.count ?? null,
      evidence: sig.evidence ?? null
    }));
  }

  const score = clamp(Math.round(total), 0, MCP_MAX_SCORE);
  const band = resolveBand(score);

  return {
    score,
    band,
    breakdown
  };
}
