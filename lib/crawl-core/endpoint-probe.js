// /lib/crawl-core/endpoint-probe.js
// Reusable endpoint probing for MCP and machine-readable resources

import axios from "axios";

const DEFAULT_TIMEOUT_MS = 8000;

function contentTypeOf(headers = {}) {
  return String(headers["content-type"] || "").toLowerCase();
}

function looksLikeJsonContentType(contentType = "") {
  return contentType.includes("application/json") || contentType.includes("+json");
}

function looksLikeYamlContentType(contentType = "") {
  return contentType.includes("application/yaml") ||
    contentType.includes("text/yaml") ||
    contentType.includes("application/x-yaml") ||
    contentType.includes("text/x-yaml") ||
    contentType.includes("yaml");
}

function isLikelyHtml(data) {
  if (typeof data !== "string") return false;
  const trimmed = data.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.includes("<body") ||
    trimmed.includes("<head");
}

function parseScalar(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseYamlMinimal(text) {
  if (typeof text !== "string") return null;
  if (isLikelyHtml(text)) return null;

  const lines = text
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith("#"));

  if (!lines.length) return null;

  const root = {};
  let currentTop = null;

  for (const line of lines) {
    const indent = (line.match(/^\s*/)?.[0] || "").length;
    const trimmed = line.trim();

    if (indent === 0) {
      const idx = trimmed.indexOf(":");
      if (idx === -1) continue;

      const key = trimmed.slice(0, idx).trim();
      const rest = trimmed.slice(idx + 1).trim();
      if (!key) continue;

      if (!rest) {
        root[key] = {};
        currentTop = key;
      } else {
        root[key] = parseScalar(rest);
        currentTop = key;
      }

      continue;
    }

    if (!currentTop) continue;

    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(root[currentTop])) root[currentTop] = [];
      root[currentTop].push(parseScalar(trimmed.slice(2)));
      continue;
    }

    const idx = trimmed.indexOf(":");
    if (idx !== -1) {
      if (Array.isArray(root[currentTop]) || typeof root[currentTop] !== "object" || root[currentTop] === null) {
        root[currentTop] = {};
      }
      const key = trimmed.slice(0, idx).trim();
      const rest = trimmed.slice(idx + 1).trim();
      root[currentTop][key] = parseScalar(rest);
    }
  }

  return Object.keys(root).length ? root : null;
}

function previewData(data) {
  if (data === null || data === undefined) return null;

  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 400 ? `${trimmed.slice(0, 400)}...` : trimmed;
  }

  try {
    const json = JSON.stringify(data);
    return json.length > 400 ? `${json.slice(0, 400)}...` : json;
  } catch {
    return null;
  }
}

export async function probeEndpoint(url, options = {}) {
  const {
    expectJson = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers = {}
  } = options;

  try {
    const resp = await axios.get(url, {
      timeout: timeoutMs,
      maxRedirects: 3,
      headers: {
        Accept: expectJson
          ? "application/json, application/yaml, text/yaml;q=0.9, text/plain;q=0.8, */*;q=0.7"
          : "*/*",
        "User-Agent": "Mozilla/5.0 (compatible; exmxc-mcp/1.0; +https://exmxc.ai)",
        ...headers
      },
      validateStatus: () => true
    });

    const status = Number(resp.status || 0);
    const statusOk = status >= 200 && status < 300;
    const contentType = contentTypeOf(resp.headers || {});
    const contentIsJson = looksLikeJsonContentType(contentType);
    const contentIsYaml = looksLikeYamlContentType(contentType);

    let parsedData = null;
    let format = null;

    if (contentIsJson) {
      if (typeof resp.data === "object" && resp.data !== null) {
        parsedData = resp.data;
        format = "json";
      } else if (typeof resp.data === "string") {
        try {
          parsedData = JSON.parse(resp.data);
          format = "json";
        } catch {
          parsedData = null;
        }
      }
    } else if (contentIsYaml && typeof resp.data === "string") {
      parsedData = parseYamlMinimal(resp.data);
      if (parsedData && typeof parsedData === "object") format = "yaml";
    }

    const parsed = parsedData !== null;
    const typedStructured = (contentIsJson || contentIsYaml) && parsed;
    const valid = expectJson ? statusOk && typedStructured : statusOk;

    return {
      detected: statusOk,
      status,
      valid,
      data: parsedData,
      format,
      contentType,
      dataPreview: previewData(expectJson ? (parsedData ?? resp.data) : resp.data)
    };
  } catch (err) {
    return {
      detected: false,
      status: 0,
      valid: false,
      data: null,
      format: null,
      contentType: "",
      dataPreview: null,
      error: err.message || "endpoint-probe-failed"
    };
  }
}
