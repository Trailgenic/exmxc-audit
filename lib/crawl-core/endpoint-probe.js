// /lib/crawl-core/endpoint-probe.js
// Reusable endpoint probing for MCP and machine-readable resources

import axios from "axios";

const DEFAULT_TIMEOUT_MS = 8000;

function looksLikeJsonContentType(headers = {}) {
  const contentType = String(headers["content-type"] || "").toLowerCase();
  return contentType.includes("application/json") || contentType.includes("+json");
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
        Accept: expectJson ? "application/json, text/plain;q=0.9, */*;q=0.8" : "*/*",
        "User-Agent": "Mozilla/5.0 (compatible; exmxc-mcp/1.0; +https://exmxc.ai)",
        ...headers
      },
      validateStatus: () => true
    });

    const status = Number(resp.status || 0);
    const statusOk = status >= 200 && status < 300;
    const contentIsJson = looksLikeJsonContentType(resp.headers || {});

    let parsedJson = null;
    let validJson = false;

    if (contentIsJson && typeof resp.data === "object" && resp.data !== null) {
      parsedJson = resp.data;
      validJson = true;
    } else if (typeof resp.data === "string") {
      try {
        parsedJson = JSON.parse(resp.data);
        validJson = true;
      } catch {
        validJson = false;
      }
    }

    const valid = expectJson ? statusOk && validJson : statusOk;

    return {
      detected: statusOk,
      status,
      valid,
      data: parsedJson,
      dataPreview: previewData(expectJson ? parsedJson ?? resp.data : resp.data)
    };
  } catch (err) {
    return {
      detected: false,
      status: 0,
      valid: false,
      data: null,
      dataPreview: null,
      error: err.message || "endpoint-probe-failed"
    };
  }
}
