// /api/mcp-audit.js
// MCP Readiness Scanner — single URL audit

import { staticCrawl } from "./core-scan.js";
import { probeEndpoint } from "../lib/crawl-core/endpoint-probe.js";
import {
  MCP_ADDITIONAL_WELL_KNOWN,
  MCP_PRIMARY_SIGNALS,
  MCP_SECONDARY_SIGNALS
} from "../shared/mcp-signals.js";
import { calculateMcpScore } from "../shared/mcp-scoring.js";
import { buildMcpAuditOutput } from "../shared/mcp-schema.js";

function normalizeUrl(input) {
  const raw = (input || "").trim();
  if (!raw) return null;

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function baseOrigin(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

function makeAbsolute(origin, path) {
  return `${origin}${path}`;
}

function collectLinkEvidence(pageLinks = [], matchers = []) {
  const evidence = new Set();

  for (const href of pageLinks) {
    const lower = String(href || "").toLowerCase();
    if (!lower) continue;

    for (const pattern of matchers) {
      if (lower.includes(pattern.toLowerCase())) evidence.add(href);
    }
  }

  return Array.from(evidence).slice(0, 10);
}

function detectStructuredData(schemaObjects = []) {
  const types = new Set();

  for (const obj of schemaObjects) {
    if (!obj || typeof obj !== "object") continue;

    const t = obj["@type"];
    if (Array.isArray(t)) {
      t.forEach(v => types.add(String(v)));
    } else if (t) {
      types.add(String(t));
    }
  }

  return {
    detected: schemaObjects.length > 0,
    jsonLdCount: schemaObjects.length,
    types: Array.from(types)
  };
}

function extractDiscoveryEndpoint(registryData) {
  if (!registryData || typeof registryData !== "object") return null;
  const endpoint = registryData?.discovery?.endpoint;
  return typeof endpoint === "string" && endpoint.trim() ? endpoint.trim() : null;
}

function asAbsoluteUrl(base, raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;

  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function collectRegistryDatasetUrls(registryData, fallbackOrigin) {
  const hits = new Set();
  const visited = new Set();
  const queue = [registryData];

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (visited.has(node)) continue;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) queue.push(item);
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") {
        const lowerKey = key.toLowerCase();
        const lowerValue = value.toLowerCase();

        const looksDataset =
          /dataset|data|download|export/.test(lowerKey) ||
          /\.(csv|jsonl|ndjson|parquet)(\?|$)/.test(lowerValue) ||
          /\/data(sets)?\b|\/open-data\b/.test(lowerValue);

        if (looksDataset) {
          const absolute = asAbsoluteUrl(fallbackOrigin, value);
          if (absolute) hits.add(absolute);
        }
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return Array.from(hits);
}

async function resolveMcpOrigin(rootOrigin) {
  const rootRegistryUrl = makeAbsolute(rootOrigin, MCP_PRIMARY_SIGNALS.toolRegistry.path);
  const rootRegistryProbe = await probeEndpoint(rootRegistryUrl, { expectJson: true });

  const registryData = rootRegistryProbe?.data && typeof rootRegistryProbe.data === "object"
    ? rootRegistryProbe.data
    : null;

  const discoveryEndpointRaw = extractDiscoveryEndpoint(registryData);
  const discoveryEndpoint = asAbsoluteUrl(rootOrigin, discoveryEndpointRaw);

  if (!discoveryEndpoint) {
    return {
      mcpOrigin: rootOrigin,
      discoveryEndpoint: null,
      rootRegistryProbe,
      registryData
    };
  }

  return {
    mcpOrigin: baseOrigin(discoveryEndpoint),
    discoveryEndpoint,
    rootRegistryProbe,
    registryData
  };
}

function deriveNotes({ score, primary, secondary, discoveryEndpoint, mcpOrigin, rootOrigin }) {
  const notes = [];

  if (discoveryEndpoint && mcpOrigin !== rootOrigin) {
    notes.push(`Discovery pointer found; MCP host resolved to ${mcpOrigin}.`);
  }

  if (primary.toolRegistry?.detected && primary.openapi?.detected) {
    notes.push("Core machine interface signals detected (tool registry + OpenAPI).");
  }

  if (!primary.aiPlugin?.detected) {
    notes.push("AI plugin manifest not found at /.well-known/ai-plugin.json.");
  }

  if (!secondary.structuredData?.detected) {
    notes.push("No JSON-LD structured data detected on homepage.");
  }

  if (score >= 80) {
    notes.push("Site appears MCP-ready for AI agent integration.");
  } else if (score >= 60) {
    notes.push("Site is partially ready; add missing primary manifests to improve readiness.");
  } else if (score >= 40) {
    notes.push("Emerging readiness; machine interfaces are incomplete.");
  } else {
    notes.push("Low readiness; publish primary well-known machine interface assets.");
  }

  return notes;
}

export async function runMcpAudit(inputUrl) {
  const url = normalizeUrl(inputUrl);

  if (!url) {
    return {
      success: false,
      error: "Invalid or missing URL"
    };
  }

  const rootOrigin = baseOrigin(url);
  const {
    mcpOrigin,
    discoveryEndpoint,
    rootRegistryProbe,
    registryData: rootRegistryData
  } = await resolveMcpOrigin(rootOrigin);

  let homepage = {
    html: "",
    schemaObjects: [],
    pageLinks: []
  };

  try {
    homepage = await staticCrawl(mcpOrigin);
  } catch {
    // Keep auditing endpoint readiness even if homepage fetch fails
  }

  const pageLinks = Array.isArray(homepage.pageLinks) ? homepage.pageLinks : [];
  const schemaObjects = Array.isArray(homepage.schemaObjects) ? homepage.schemaObjects : [];

  const primarySignals = {};

  for (const [key, cfg] of Object.entries(MCP_PRIMARY_SIGNALS)) {
    const endpointUrl = makeAbsolute(mcpOrigin, cfg.path);
    const probe = await probeEndpoint(endpointUrl, { expectJson: true });

    primarySignals[key] = {
      detected: probe.detected,
      url: endpointUrl,
      status: probe.status,
      valid: probe.valid,
      dataPreview: probe.dataPreview
    };
  }

  const mcpManifestUrl = makeAbsolute(mcpOrigin, MCP_ADDITIONAL_WELL_KNOWN.mcpManifest.path);
  const mcpManifestProbe = await probeEndpoint(mcpManifestUrl, { expectJson: true });
  primarySignals.mcpManifest = {
    detected: mcpManifestProbe.detected,
    url: mcpManifestUrl,
    status: mcpManifestProbe.status,
    valid: mcpManifestProbe.valid,
    dataPreview: mcpManifestProbe.dataPreview
  };

  const apiDocsEvidence = collectLinkEvidence(pageLinks, MCP_SECONDARY_SIGNALS.apiDocs.paths);
  for (const path of MCP_SECONDARY_SIGNALS.apiDocs.paths) {
    const probe = await probeEndpoint(makeAbsolute(mcpOrigin, path), { expectJson: false });
    if (probe.detected) apiDocsEvidence.push(path);
  }

  const secondarySignals = {
    apiDocs: {
      detected: apiDocsEvidence.length > 0,
      evidence: Array.from(new Set(apiDocsEvidence)).slice(0, 10)
    },
    jsonEndpoints: {
      detected: false,
      count: 0,
      evidence: []
    },
    datasets: {
      detected: false,
      evidence: []
    },
    structuredData: detectStructuredData(schemaObjects)
  };

  for (const path of MCP_SECONDARY_SIGNALS.jsonEndpoints.paths) {
    const endpointUrl = makeAbsolute(mcpOrigin, path);
    const probe = await probeEndpoint(endpointUrl, { expectJson: true });
    if (probe.detected && probe.valid) {
      secondarySignals.jsonEndpoints.evidence.push(endpointUrl);
    }
  }

  secondarySignals.jsonEndpoints.evidence = Array.from(new Set(secondarySignals.jsonEndpoints.evidence));
  secondarySignals.jsonEndpoints.count = secondarySignals.jsonEndpoints.evidence.length;
  secondarySignals.jsonEndpoints.detected = secondarySignals.jsonEndpoints.count > 0;

  const datasetEvidence = collectLinkEvidence(
    pageLinks,
    [...MCP_SECONDARY_SIGNALS.datasets.paths, ...MCP_SECONDARY_SIGNALS.datasets.extensions]
  );

  for (const path of MCP_SECONDARY_SIGNALS.datasets.paths) {
    const endpointUrl = makeAbsolute(mcpOrigin, path);
    const probe = await probeEndpoint(endpointUrl, { expectJson: false });
    if (probe.detected) datasetEvidence.push(endpointUrl);
  }

  const activeRegistryData = primarySignals.toolRegistry.detected
    ? (await probeEndpoint(primarySignals.toolRegistry.url, { expectJson: true })).data
    : rootRegistryData;

  for (const datasetUrl of collectRegistryDatasetUrls(activeRegistryData, mcpOrigin)) {
    datasetEvidence.push(datasetUrl);
  }

  secondarySignals.datasets.evidence = Array.from(new Set(datasetEvidence)).slice(0, 10);
  secondarySignals.datasets.detected = secondarySignals.datasets.evidence.length > 0;

  const signals = {
    primary: primarySignals,
    secondary: secondarySignals
  };

  const scoring = calculateMcpScore(signals);
  const notes = deriveNotes({
    score: scoring.score,
    primary: primarySignals,
    secondary: secondarySignals,
    discoveryEndpoint,
    mcpOrigin,
    rootOrigin
  });

  const output = buildMcpAuditOutput({
    url,
    score: scoring.score,
    band: scoring.band,
    signals,
    breakdown: scoring.breakdown,
    notes
  });

  output.discovery = {
    rootOrigin,
    mcpOrigin,
    pointer: discoveryEndpoint,
    pointerDetected: Boolean(discoveryEndpoint),
    rootRegistryStatus: rootRegistryProbe?.status ?? 0
  };

  return output;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const output = await runMcpAudit(req.query?.url);

    if (!output?.success) {
      return res.status(400).json(output);
    }

    return res.status(200).json(output);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "MCP audit failed"
    });
  }
}
