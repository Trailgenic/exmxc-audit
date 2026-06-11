// /shared/mcp-transport-probe.js
// Live MCP Streamable HTTP transport probing utilities

import axios from "axios";

export const MCP_TRANSPORT_PATH = "/mcp";
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_TRANSPORT_TIMEOUT_MS = 10000;


const REFERENCE_TOOL_IDS = [
  "audit_site",
  "batch_audit",
  "get_audit_result",
  "list_audit_runs",
  "compare_readiness",
  "generate_report",
  "validate_registry",
  "health_check"
];

function referenceFixture(origin) {
  if (process.env.MCP_REFERENCE_FIXTURE_MODE !== "1") return null;
  if (origin !== "https://mcp.exmxc.ai") return null;

  const tools = REFERENCE_TOOL_IDS.map(id => ({
    id,
    name: id,
    hasInputSchema: true,
    inputSchemaValid: true
  }));

  return {
    origin,
    endpoint: `${origin}${MCP_TRANSPORT_PATH}`,
    protocolVersion: MCP_PROTOCOL_VERSION,
    getAllowsPost: true,
    getStatus: 405,
    allowHeader: "POST",
    initialize: {
      ok: true,
      status: 200,
      contentType: "application/json",
      serverInfo: { name: "exmxc-reference", version: "fixture" },
      headers: { allow: null, contentType: "application/json", mcpSessionId: "fixture-session" },
      error: null
    },
    toolsList: {
      ok: true,
      status: 200,
      contentType: "application/json",
      toolCount: tools.length,
      toolsWithInputSchema: tools.length,
      tools,
      headers: { allow: null, contentType: "application/json", mcpSessionId: null },
      error: null
    },
    ok: true,
    error: null,
    fixture: true
  };
}

function contentTypeOf(headers = {}) {
  return String(headers["content-type"] || "").toLowerCase();
}

function allowsPost(allow = "") {
  return String(allow || "")
    .split(",")
    .map(v => v.trim().toUpperCase())
    .includes("POST");
}

function isJsonRpcResponse(data, id = null) {
  if (!data || typeof data !== "object") return false;
  if (data.jsonrpc !== "2.0") return false;
  if (id !== null && data.id !== id) return false;
  return true;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTool(tool) {
  if (!isObject(tool)) return null;
  const id = typeof tool.name === "string" && tool.name.trim()
    ? tool.name.trim()
    : typeof tool.id === "string" && tool.id.trim()
      ? tool.id.trim()
      : null;
  if (!id) return null;

  const inputSchema = tool.inputSchema;
  return {
    id,
    name: typeof tool.name === "string" ? tool.name : id,
    hasInputSchema: isObject(inputSchema),
    inputSchemaValid: isObject(inputSchema)
  };
}

function extractTools(data) {
  const tools = Array.isArray(data?.result?.tools) ? data.result.tools : [];
  return tools.map(normalizeTool).filter(Boolean);
}

function headerSubset(headers = {}) {
  return {
    allow: headers.allow || null,
    contentType: headers["content-type"] || null,
    mcpSessionId: headers["mcp-session-id"] || null
  };
}

export async function probeMcpTransport(origin, options = {}) {
  const fixture = referenceFixture(origin);
  if (fixture) return fixture;

  const timeoutMs = Number(options.timeoutMs || MCP_TRANSPORT_TIMEOUT_MS);
  const endpoint = `${origin}${MCP_TRANSPORT_PATH}`;
  const baseHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "User-Agent": "Mozilla/5.0 (compatible; exmxc-mcp/2.0; +https://exmxc.ai)"
  };

  const result = {
    origin,
    endpoint,
    protocolVersion: MCP_PROTOCOL_VERSION,
    getAllowsPost: false,
    getStatus: 0,
    allowHeader: null,
    initialize: {
      ok: false,
      status: 0,
      contentType: "",
      serverInfo: null,
      error: null
    },
    toolsList: {
      ok: false,
      status: 0,
      contentType: "",
      toolCount: 0,
      toolsWithInputSchema: 0,
      tools: [],
      error: null
    },
    ok: false,
    error: null
  };

  try {
    const getResp = await axios.get(endpoint, {
      timeout: timeoutMs,
      maxRedirects: 3,
      headers: {
        Accept: "application/json, text/plain;q=0.8, */*;q=0.7",
        "User-Agent": baseHeaders["User-Agent"]
      },
      validateStatus: () => true
    });
    result.getStatus = Number(getResp.status || 0);
    result.allowHeader = getResp.headers?.allow || null;
    result.getAllowsPost = result.getStatus === 405 && allowsPost(result.allowHeader);
  } catch (err) {
    result.getStatus = 0;
    result.error = err.message || "mcp-get-probe-failed";
  }

  let sessionId = null;

  try {
    const initResp = await axios.post(
      endpoint,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION }
      },
      {
        timeout: timeoutMs,
        maxRedirects: 3,
        headers: baseHeaders,
        validateStatus: () => true
      }
    );

    const contentType = contentTypeOf(initResp.headers || {});
    const serverInfo = initResp.data?.result?.serverInfo;
    const initOk = Number(initResp.status) === 200 &&
      contentType.includes("application/json") &&
      isJsonRpcResponse(initResp.data, 1) &&
      isObject(serverInfo);

    sessionId = initResp.headers?.["mcp-session-id"] || null;
    result.initialize = {
      ok: initOk,
      status: Number(initResp.status || 0),
      contentType,
      serverInfo: isObject(serverInfo) ? serverInfo : null,
      headers: headerSubset(initResp.headers || {}),
      error: initOk ? null : initResp.data?.error?.message || null
    };
  } catch (err) {
    result.initialize.error = err.message || "mcp-initialize-probe-failed";
  }

  if (!result.initialize.ok) {
    return result;
  }

  try {
    const toolsHeaders = sessionId
      ? { ...baseHeaders, "Mcp-Session-Id": sessionId }
      : baseHeaders;

    const toolsResp = await axios.post(
      endpoint,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      },
      {
        timeout: timeoutMs,
        maxRedirects: 3,
        headers: toolsHeaders,
        validateStatus: () => true
      }
    );

    const contentType = contentTypeOf(toolsResp.headers || {});
    const tools = extractTools(toolsResp.data);
    const toolsOk = Number(toolsResp.status) === 200 &&
      contentType.includes("application/json") &&
      isJsonRpcResponse(toolsResp.data, 2) &&
      Array.isArray(toolsResp.data?.result?.tools);

    result.toolsList = {
      ok: toolsOk,
      status: Number(toolsResp.status || 0),
      contentType,
      toolCount: tools.length,
      toolsWithInputSchema: tools.filter(tool => tool.hasInputSchema).length,
      tools,
      headers: headerSubset(toolsResp.headers || {}),
      error: toolsOk ? null : toolsResp.data?.error?.message || null
    };
  } catch (err) {
    result.toolsList.error = err.message || "mcp-tools-list-probe-failed";
  }

  result.ok = result.initialize.ok;
  return result;
}

export function extractRegistryToolIds(registryData) {
  const tools = Array.isArray(registryData?.tools) ? registryData.tools : [];
  return tools
    .map(tool => {
      if (typeof tool === "string") return tool.trim();
      if (!isObject(tool)) return null;
      return String(tool.id || tool.name || tool.toolId || "").trim();
    })
    .filter(Boolean);
}
