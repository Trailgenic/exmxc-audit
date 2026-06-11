// /shared/mcp-scoring.js
// MCP readiness scoring engine

import {
  MCP_BAND_THRESHOLDS,
  MCP_DIMENSION_WEIGHTS,
  MCP_MAX_SCORE,
  MCP_PRIMARY_SIGNALS,
  MCP_SECONDARY_SIGNALS
} from "./mcp-signals.js";
import { extractRegistryToolIds } from "./mcp-transport-probe.js";

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

function pctPoints(weight, ratio) {
  return Math.round(weight * clamp(ratio, 0, 1));
}

function compareToolIds(registryIds = [], liveIds = []) {
  const registrySet = new Set(registryIds);
  const liveSet = new Set(liveIds);
  const matched = liveIds.filter(id => registrySet.has(id));
  const missingFromLive = registryIds.filter(id => !liveSet.has(id));
  const missingFromRegistry = liveIds.filter(id => !registrySet.has(id));
  const denominator = Math.max(registryIds.length, liveIds.length, 1);

  return {
    matched,
    missingFromLive,
    missingFromRegistry,
    ratio: matched.length / denominator
  };
}

export function calculateMcpScore(signals = {}) {
  const primary = signals.primary || {};
  const secondary = signals.secondary || {};
  const transport = signals.transport || {};
  const registryData = signals.registryData || null;

  const breakdown = [];
  const dimensions = {};
  let total = 0;

  const discoveryHits = [primary.mcpManifest, primary.toolRegistry]
    .filter(sig => sig?.detected === true && sig?.valid === true);
  const discoveryPoints = discoveryHits.length > 0 ? MCP_DIMENSION_WEIGHTS.discovery : 0;
  dimensions.discovery = {
    points: discoveryPoints,
    max: MCP_DIMENSION_WEIGHTS.discovery,
    present: discoveryHits.length > 0,
    mcpManifest: Boolean(primary.mcpManifest?.valid),
    toolRegistry: Boolean(primary.toolRegistry?.valid)
  };
  total += discoveryPoints;
  breakdown.push(lineItem(
    "MCP discovery manifests",
    discoveryPoints,
    MCP_DIMENSION_WEIGHTS.discovery,
    discoveryPoints ? ".well-known MCP discovery is present and parseable" : "No parseable .well-known MCP discovery manifest",
    {
      mcpManifest: primary.mcpManifest?.url ?? null,
      toolRegistry: primary.toolRegistry?.url ?? null
    }
  ));

  const initializeOk = transport?.initialize?.ok === true;
  const transportPoints = initializeOk ? MCP_DIMENSION_WEIGHTS.transport : 0;
  dimensions.transport = {
    points: transportPoints,
    max: MCP_DIMENSION_WEIGHTS.transport,
    initializeOk,
    getAllowsPost: transport?.getAllowsPost === true,
    status: transport?.initialize?.status ?? 0,
    endpoint: transport?.endpoint ?? null,
    serverInfo: transport?.initialize?.serverInfo ?? null
  };
  total += transportPoints;
  breakdown.push(lineItem(
    "Live MCP Streamable HTTP transport",
    transportPoints,
    MCP_DIMENSION_WEIGHTS.transport,
    initializeOk ? "JSON-RPC initialize handshake succeeded" : "No valid live initialize handshake",
    {
      endpoint: transport?.endpoint ?? null,
      initializeStatus: transport?.initialize?.status ?? 0,
      getStatus: transport?.getStatus ?? 0,
      getAllowsPost: transport?.getAllowsPost === true
    }
  ));

  const toolCount = Number(transport?.toolsList?.toolCount || 0);
  const toolsWithSchema = Number(transport?.toolsList?.toolsWithInputSchema || 0);
  const toolsListOk = transport?.toolsList?.ok === true;
  const toolingRatio = toolCount > 0 ? toolsWithSchema / toolCount : 0;
  const toolingPoints = toolsListOk && toolCount > 0
    ? pctPoints(MCP_DIMENSION_WEIGHTS.tooling, toolingRatio)
    : 0;
  dimensions.tooling = {
    points: toolingPoints,
    max: MCP_DIMENSION_WEIGHTS.tooling,
    toolsListOk,
    toolCount,
    toolsWithInputSchema: toolsWithSchema,
    allToolsHaveInputSchema: toolCount > 0 && toolsWithSchema === toolCount
  };
  total += toolingPoints;
  breakdown.push(lineItem(
    "Live MCP tool inventory",
    toolingPoints,
    MCP_DIMENSION_WEIGHTS.tooling,
    toolingPoints === MCP_DIMENSION_WEIGHTS.tooling
      ? "tools/list returned tools with input schemas"
      : toolsListOk && toolCount > 0
        ? "tools/list returned tools but some input schemas are missing"
        : "No usable tools/list result",
    {
      toolCount,
      toolsWithInputSchema: toolsWithSchema
    }
  ));

  const registryIds = extractRegistryToolIds(registryData);
  const liveIds = Array.isArray(transport?.toolsList?.tools)
    ? transport.toolsList.tools.map(tool => tool.id).filter(Boolean)
    : [];
  const canCompare = registryIds.length > 0 && liveIds.length > 0;
  const comparison = canCompare ? compareToolIds(registryIds, liveIds) : null;
  const consistencyPoints = canCompare
    ? pctPoints(MCP_DIMENSION_WEIGHTS.consistency, comparison.ratio)
    : 0;
  dimensions.consistency = {
    points: consistencyPoints,
    max: MCP_DIMENSION_WEIGHTS.consistency,
    compared: canCompare,
    registryToolCount: registryIds.length,
    liveToolCount: liveIds.length,
    matchedToolCount: comparison?.matched.length ?? 0,
    missingFromLive: comparison?.missingFromLive ?? [],
    missingFromRegistry: comparison?.missingFromRegistry ?? []
  };
  total += consistencyPoints;
  breakdown.push(lineItem(
    "Cross-surface tool consistency",
    consistencyPoints,
    MCP_DIMENSION_WEIGHTS.consistency,
    !canCompare
      ? "Registry/live tool comparison unavailable"
      : consistencyPoints === MCP_DIMENSION_WEIGHTS.consistency
        ? "Registry tool IDs match live tools/list IDs"
        : "Registry/live tool drift detected",
    dimensions.consistency
  ));

  const legacy = primary.aiPlugin || {};
  const legacyPoints = legacy.detected === true && legacy.valid === true
    ? MCP_DIMENSION_WEIGHTS.legacyDiscovery
    : 0;
  dimensions.legacyDiscovery = {
    points: legacyPoints,
    max: MCP_DIMENSION_WEIGHTS.legacyDiscovery,
    aiPlugin: legacyPoints > 0
  };
  total += legacyPoints;
  breakdown.push(lineItem(
    MCP_PRIMARY_SIGNALS.aiPlugin.label,
    legacyPoints,
    MCP_DIMENSION_WEIGHTS.legacyDiscovery,
    legacyPoints ? "Legacy OpenAI plugin manifest detected" : "Legacy OpenAI plugin manifest missing or invalid",
    { status: legacy.status ?? null, url: legacy.url ?? null }
  ));

  for (const [key, cfg] of Object.entries(MCP_SECONDARY_SIGNALS)) {
    const sig = secondary[key] || {};
    const detected = sig.detected === true;
    breakdown.push(lineItem(cfg.label, 0, 0, detected ? "Detected (informational)" : "Not detected", {
      count: sig.count ?? null,
      evidence: sig.evidence ?? null
    }));
  }

  const score = clamp(Math.round(total), 0, MCP_MAX_SCORE);
  const band = resolveBand(score);

  return {
    score,
    band,
    breakdown,
    dimensions
  };
}
