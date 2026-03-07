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

function deriveNotes({ score, primary, secondary }) {
  const notes = [];

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const input = req.query?.url;
    const url = normalizeUrl(input);

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing URL"
      });
    }

    const origin = baseOrigin(url);

    let homepage = {
      html: "",
      schemaObjects: [],
      pageLinks: []
    };

    try {
      homepage = await staticCrawl(url);
    } catch {
      // Keep auditing endpoint readiness even if homepage fetch fails
    }

    const pageLinks = Array.isArray(homepage.pageLinks) ? homepage.pageLinks : [];
    const schemaObjects = Array.isArray(homepage.schemaObjects) ? homepage.schemaObjects : [];

    const primarySignals = {};

    for (const [key, cfg] of Object.entries(MCP_PRIMARY_SIGNALS)) {
      const endpointUrl = makeAbsolute(origin, cfg.path);
      const probe = await probeEndpoint(endpointUrl, { expectJson: true });

      primarySignals[key] = {
        detected: probe.detected,
        url: endpointUrl,
        status: probe.status,
        valid: probe.valid,
        dataPreview: probe.dataPreview
      };
    }

    const mcpManifestUrl = makeAbsolute(origin, MCP_ADDITIONAL_WELL_KNOWN.mcpManifest.path);
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
      const probe = await probeEndpoint(makeAbsolute(origin, path), { expectJson: false });
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
      const endpointUrl = makeAbsolute(origin, path);
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
      const endpointUrl = makeAbsolute(origin, path);
      const probe = await probeEndpoint(endpointUrl, { expectJson: false });
      if (probe.detected) datasetEvidence.push(endpointUrl);
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
      secondary: secondarySignals
    });

    const output = buildMcpAuditOutput({
      url,
      score: scoring.score,
      band: scoring.band,
      signals,
      breakdown: scoring.breakdown,
      notes
    });

    return res.status(200).json(output);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "MCP audit failed"
    });
  }
}
