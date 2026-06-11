// /scripts/mcp-readiness-reference-test.js
// Regression guard for the EXMXC reference MCP Streamable HTTP endpoint.

import assert from "node:assert/strict";

const live = process.argv.includes("--live");
if (!live) {
  process.env.MCP_REFERENCE_FIXTURE_MODE = "1";
}

const { runMcpAudit } = await import("../api/mcp-audit.js");

const target = "https://mcp.exmxc.ai";
const result = await runMcpAudit(target);
const dimensions = result?.dimensions || result?.mcp?.dimensions || {};

assert.equal(result?.success, true, "audit should succeed");
assert.equal(result?.methodologyVersion, "MCP-readiness v2", "methodology version should be v2");
assert.equal(dimensions.transport?.points, dimensions.transport?.max, "transport should receive maximum marks");
assert.equal(dimensions.tooling?.points, dimensions.tooling?.max, "tooling should receive maximum marks");
assert.equal(dimensions.consistency?.points, dimensions.consistency?.max, "consistency should receive maximum marks");
assert.equal(dimensions.tooling?.toolCount, 8, "reference endpoint should report 8 tools");

console.log(JSON.stringify({
  target,
  mode: live ? "live" : "fixture",
  score: result.mcp.score,
  band: result.mcp.band,
  methodologyVersion: result.methodologyVersion,
  dimensions: result.dimensions
}, null, 2));
