// /shared/mcp-signals.js
// MCP Readiness signal definitions and scoring weights

export const MCP_PRIMARY_SIGNALS = {
  toolRegistry: {
    key: "toolRegistry",
    label: "Tool Registry",
    path: "/.well-known/tool-registry.json",
    weight: 25
  },
  openapi: {
    key: "openapi",
    label: "OpenAPI Specification",
    path: "/.well-known/openapi.json",
    weight: 25
  },
  aiPlugin: {
    key: "aiPlugin",
    label: "AI Plugin Manifest",
    path: "/.well-known/ai-plugin.json",
    weight: 20
  }
};

export const MCP_ADDITIONAL_WELL_KNOWN = {
  mcpManifest: {
    key: "mcpManifest",
    label: "MCP Manifest",
    path: "/.well-known/mcp.json"
  }
};

export const MCP_SECONDARY_SIGNALS = {
  apiDocs: {
    key: "apiDocs",
    label: "API Documentation",
    weight: 10,
    paths: ["/docs", "/api", "/developers", "/swagger", "/redoc"]
  },
  jsonEndpoints: {
    key: "jsonEndpoints",
    label: "Machine-readable JSON Endpoints",
    weight: 8,
    paths: ["/api", "/api/v1", "/status.json", "/health", "/version", "/feed.json"]
  },
  datasets: {
    key: "datasets",
    label: "Dataset Exposure",
    weight: 6,
    paths: ["/data", "/datasets", "/open-data"],
    extensions: [".csv", ".jsonl", ".ndjson", ".parquet"]
  },
  structuredData: {
    key: "structuredData",
    label: "Structured Data for Agents",
    weight: 6
  }
};

export const MCP_MAX_SCORE = 100;

export const MCP_BAND_THRESHOLDS = {
  mcpReady: 80,
  partiallyReady: 60,
  emerging: 40
};
