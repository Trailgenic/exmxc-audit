// /shared/mcp-schema.js
// Stable output shaping for MCP scanner responses

import { MCP_MAX_SCORE } from "./mcp-signals.js";

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function buildMcpAuditOutput({
  url,
  score,
  band,
  signals,
  breakdown,
  notes = [],
  capability = null
}) {
  const hostname = hostnameOf(url);

  const detected = [];
  const missing = [];

  const primary = signals?.primary || {};
  const secondary = signals?.secondary || {};

  for (const [key, value] of Object.entries(primary)) {
    if (value?.detected) detected.push(key);
    else missing.push(key);
  }

  for (const [key, value] of Object.entries(secondary)) {
    if (value?.detected) detected.push(key);
    else missing.push(key);
  }

  return {
    success: true,
    url,
    hostname,
    mcp: {
      score,
      max: MCP_MAX_SCORE,
      band
    },
    signals: {
      primary,
      secondary
    },
    signals_detected: detected,
    signals_missing: missing,
    breakdown,
    notes,
    capability: capability || {
      mcp_present: false,
      mcp_exposure: "unknown",
      mcp_auth: "unknown",
      evidence: { items: [] }
    },
    timestamp: new Date().toISOString()
  };
}
