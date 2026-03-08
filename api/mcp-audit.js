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

const PRIMARY_KEYS = ["toolRegistry", "openapi", "aiPlugin"];
const CAPABILITY_PROBE_TIMEOUT_MS = 7000;
const CAPABILITY_MAX_REQUESTS = 3;
const DOCS_KEYWORDS = [
  "mcp.",
  "model context protocol",
  "tool-registry.json",
  "openapi.json",
  "ai-plugin.json",
  "mcp server"
];

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
  const rootUrl = new URL(rootOrigin);
  const rootHost = rootUrl.hostname.replace(/^www\./i, "");
  const protocol = rootUrl.protocol || "https:";

  const candidateOrigins = [
    `${protocol}//${rootHost}`,
    `${protocol}//mcp.${rootHost}`,
    `${protocol}//discovery.${rootHost}`,
    `${protocol}//api.${rootHost}`
  ].filter((origin, idx, arr) => arr.indexOf(origin) === idx);

  const scanOneOrigin = async (origin) => {
    const entries = await Promise.all(Object.entries(MCP_PRIMARY_SIGNALS).map(async ([key, cfg]) => {
      const url = makeAbsolute(origin, cfg.path);
      const probe = await probeEndpoint(url, { expectJson: true });
      const structured = isStructuredSpecProbe(probe);
      const schemaValid = structured && validatePrimarySignalSchema(key, probe.data);
      return [key, { url, probe, schemaValid }];
    }));

    const mcpManifestUrl = makeAbsolute(origin, MCP_ADDITIONAL_WELL_KNOWN.mcpManifest.path);
    const mcpManifestProbe = await probeEndpoint(mcpManifestUrl, { expectJson: true });
    const mcpManifestValid = isStructuredSpecProbe(mcpManifestProbe);

    const probes = Object.fromEntries(entries);
    probes.mcpManifest = {
      url: mcpManifestUrl,
      probe: mcpManifestProbe,
      schemaValid: mcpManifestValid
    };

    const anyValidPrimary = Object.values(probes).some(item => item?.schemaValid === true);

    return {
      origin,
      probes,
      anyValidPrimary
    };
  };

  const hostScans = await Promise.all(candidateOrigins.map(origin => scanOneOrigin(origin)));

  const rootScan = hostScans.find(scan => scan.origin === `${protocol}//${rootHost}`) || hostScans[0];
  const rootRegistryProbe = rootScan?.probes?.toolRegistry?.probe || {
    status: 0,
    data: null
  };
  const rootRegistryData = rootRegistryProbe?.data && typeof rootRegistryProbe.data === "object"
    ? rootRegistryProbe.data
    : null;

  const discoveryHostScan = hostScans.find(scan => scan.origin === `${protocol}//discovery.${rootHost}`);
  const discoveryPointerRaw = discoveryHostScan?.probes?.mcpManifest?.probe?.data?.endpoint;
  const discoveryEndpoint = asAbsoluteUrl(discoveryHostScan?.origin || rootOrigin, discoveryPointerRaw);

  if (discoveryEndpoint) {
    return {
      mcpOrigin: baseOrigin(discoveryEndpoint),
      discoveryEndpoint,
      rootRegistryProbe,
      registryData: rootRegistryData
    };
  }

  const firstValidHost = hostScans.find(scan => scan.anyValidPrimary);

  return {
    mcpOrigin: firstValidHost?.origin || rootOrigin,
    discoveryEndpoint: null,
    rootRegistryProbe,
    registryData: rootRegistryData
  };
}

function isStructuredSpecProbe(probe) {
  const statusOk = Number(probe?.status) === 200;
  const formatOk = probe?.format === "json" || probe?.format === "yaml";
  const parsedOk = Boolean(probe?.data && typeof probe.data === "object");
  return statusOk && formatOk && parsedOk;
}

function validateOpenApiSchema(data) {
  if (!data || typeof data !== "object") return false;
  const hasVersion = typeof data.openapi === "string" || typeof data.swagger === "string";
  const hasPaths = data.paths && typeof data.paths === "object" && !Array.isArray(data.paths);
  return hasVersion && hasPaths;
}

function validateToolRegistrySchema(data) {
  if (!data || typeof data !== "object") return false;
  return Array.isArray(data.tools);
}

function validateAiPluginSchema(data) {
  if (!data || typeof data !== "object") return false;
  const hasSchemaVersion = typeof data.schema_version === "string" && data.schema_version.trim().length > 0;
  const hasApi = data.api && typeof data.api === "object";
  return hasSchemaVersion && hasApi;
}

function validatePrimarySignalSchema(key, data) {
  if (key === "openapi") return validateOpenApiSchema(data);
  if (key === "toolRegistry") return validateToolRegistrySchema(data);
  if (key === "aiPlugin") return validateAiPluginSchema(data);
  return true;
}

function hostWithoutWww(origin) {
  try {
    return new URL(origin).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function isAuthStatus(status) {
  return [401, 403, 407].includes(Number(status));
}

function hasAuthWording(text) {
  const lower = String(text || "").toLowerCase();
  return /auth|required|unauthorized|forbidden|token|login|access denied|challenge/.test(lower);
}

function hasMcpishJson(data) {
  if (!data || typeof data !== "object") return false;
  const keys = Object.keys(data).map(k => k.toLowerCase());
  return keys.some(k => ["tools", "registry", "capabilities", "mcp"].includes(k) || k.includes("mcp"));
}

function findKeywordSnippet(text, keywords) {
  const lower = String(text || "").toLowerCase();
  if (!lower) return null;

  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx === -1) continue;

    const start = Math.max(0, idx - 40);
    const end = Math.min(lower.length, idx + needle.length + 80);
    return String(text).slice(start, end).replace(/\s+/g, " ").trim();
  }

  return null;
}

function formatProbeEvidence(url, probe, snippet = "") {
  const status = Number(probe?.status || 0);
  const contentType = probe?.contentType ? ` ${probe.contentType}` : "";
  const details = snippet ? ` :: ${snippet}` : "";
  return `${url} [${status}${contentType}]${details}`.slice(0, 240);
}

function collectAuthHints(primarySignals = {}, probes = []) {
  for (const key of PRIMARY_KEYS) {
    const signal = primarySignals[key];
    if (isAuthStatus(signal?.status)) return true;
    if (hasAuthWording(signal?.dataPreview)) return true;
  }

  for (const probe of probes) {
    if (!probe) continue;
    if (isAuthStatus(probe.status)) return true;
    if (hasAuthWording(probe.textSample || probe.dataPreview)) return true;
  }

  return false;
}

async function detectCapabilityFlags({ rootOrigin, mcpOrigin, primarySignals }) {
  const evidence = [];
  const addEvidence = (line) => {
    if (!line || evidence.length >= 3) return;
    evidence.push(String(line).slice(0, 240));
  };

  const allPrimaryValid = PRIMARY_KEYS.every(key => primarySignals?.[key]?.valid === true);

  if (allPrimaryValid) {
    return {
      mcp_present: true,
      mcp_exposure: "public_manifest",
      mcp_auth: collectAuthHints(primarySignals) ? "gated" : "open",
      evidence: { items: [makeAbsolute(mcpOrigin, MCP_PRIMARY_SIGNALS.toolRegistry.path)] }
    };
  }

  let requestCount = 0;
  const extraProbes = [];
  const canProbe = () => requestCount < CAPABILITY_MAX_REQUESTS;
  const cappedProbe = async (url, options = {}) => {
    if (!canProbe()) return null;
    requestCount += 1;
    const probe = await probeEndpoint(url, {
      expectJson: false,
      timeoutMs: CAPABILITY_PROBE_TIMEOUT_MS,
      ...options
    });
    extraProbes.push(probe);
    return probe;
  };

  const rootHost = hostWithoutWww(rootOrigin);
  let exposure = "unknown";

  // 1) Probe runtime MCP subdomain
  const runtimeUrl = rootHost ? `https://mcp.${rootHost}/` : null;
  if (runtimeUrl) {
    const runtimeProbe = await cappedProbe(runtimeUrl, {
      headers: { Accept: "application/json, text/plain;q=0.9, text/html;q=0.8, */*;q=0.7" }
    });

    if (runtimeProbe) {
      if ((Number(runtimeProbe.status) === 200 && runtimeProbe.format === "json" && hasMcpishJson(runtimeProbe.data)) || isAuthStatus(runtimeProbe.status)) {
        exposure = "runtime_only";
        const snippet = hasMcpishJson(runtimeProbe.data) ? "mcp-like JSON response" : "auth required";
        addEvidence(formatProbeEvidence(runtimeUrl, runtimeProbe, snippet));
      }
    }
  }

  // 2) Probe docs subdomain when still unknown
  if (exposure === "unknown" && rootHost && canProbe()) {
    const docsMcpUrl = `https://docs.${rootHost}/mcp`;
    let docsProbe = await cappedProbe(docsMcpUrl, { headers: { Accept: "text/html, text/plain;q=0.9, */*;q=0.8" } });
    let docsUrlUsed = docsMcpUrl;

    if (docsProbe && Number(docsProbe.status) === 404 && canProbe()) {
      docsUrlUsed = `https://docs.${rootHost}/`;
      docsProbe = await cappedProbe(docsUrlUsed, { headers: { Accept: "text/html, text/plain;q=0.9, */*;q=0.8" } });
    }

    if (docsProbe) {
      const snippet = findKeywordSnippet(docsProbe.textSample || docsProbe.dataPreview || "", DOCS_KEYWORDS);
      if (snippet || isAuthStatus(docsProbe.status)) {
        exposure = "docs_led";
        addEvidence(formatProbeEvidence(docsUrlUsed, docsProbe, snippet || "auth required"));
      }
    }
  }

  // 3) Optional final probe on root host
  if (exposure === "unknown" && rootHost && canProbe()) {
    const fallbackDocsUrl = `https://${rootHost}/mcp`;
    const fallbackProbe = await cappedProbe(fallbackDocsUrl, {
      headers: { Accept: "text/html, text/plain;q=0.9, */*;q=0.8" }
    });

    if (fallbackProbe) {
      const snippet = findKeywordSnippet(fallbackProbe.textSample || fallbackProbe.dataPreview || "", DOCS_KEYWORDS);
      if (snippet || isAuthStatus(fallbackProbe.status)) {
        exposure = "docs_led";
        addEvidence(formatProbeEvidence(fallbackDocsUrl, fallbackProbe, snippet || "auth required"));
      }
    }
  }

  const authGated = collectAuthHints(primarySignals, extraProbes);

  if (exposure === "unknown") {
    addEvidence("No public manifests or capability evidence found in capped probes.");
  }

  return {
    mcp_present: exposure !== "unknown",
    mcp_exposure: exposure,
    mcp_auth: authGated ? "gated" : "unknown",
    evidence: { items: evidence.slice(0, 3) }
  };
}

function deriveNotes({ score, primary, secondary, discoveryEndpoint, mcpOrigin, rootOrigin, capability }) {
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

  if (capability?.mcp_exposure === "docs_led") {
    notes.push("Capability evidence suggests docs-led MCP onboarding despite missing public manifests.");
  } else if (capability?.mcp_exposure === "runtime_only") {
    notes.push("Capability evidence suggests runtime MCP host without public well-known manifests.");
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
  const primaryData = {};

  for (const [key, cfg] of Object.entries(MCP_PRIMARY_SIGNALS)) {
    const endpointUrl = makeAbsolute(mcpOrigin, cfg.path);
    const probe = await probeEndpoint(endpointUrl, { expectJson: true });

    const structured = isStructuredSpecProbe(probe);
    const schemaValid = structured && validatePrimarySignalSchema(key, probe.data);

    primaryData[key] = probe.data;
    primarySignals[key] = {
      detected: schemaValid,
      url: endpointUrl,
      status: probe.status,
      valid: schemaValid,
      schemaValid,
      format: probe.format,
      contentType: probe.contentType,
      dataPreview: probe.dataPreview
    };
  }

  const mcpManifestUrl = makeAbsolute(mcpOrigin, MCP_ADDITIONAL_WELL_KNOWN.mcpManifest.path);
  const mcpManifestProbe = await probeEndpoint(mcpManifestUrl, { expectJson: true });
  const manifestValid = isStructuredSpecProbe(mcpManifestProbe);
  primarySignals.mcpManifest = {
    detected: manifestValid,
    url: mcpManifestUrl,
    status: mcpManifestProbe.status,
    valid: manifestValid,
    format: mcpManifestProbe.format,
    contentType: mcpManifestProbe.contentType,
    dataPreview: mcpManifestProbe.dataPreview
  };

  const capability = await detectCapabilityFlags({
    rootOrigin,
    mcpOrigin,
    primarySignals
  });

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
    ? primaryData.toolRegistry
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
    rootOrigin,
    capability
  });

  const output = buildMcpAuditOutput({
    url,
    score: scoring.score,
    band: scoring.band,
    signals,
    breakdown: scoring.breakdown,
    notes,
    capability
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
