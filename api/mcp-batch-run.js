// /api/mcp-batch-run.js
// MCP Readiness Scanner — batch orchestrator

import fs from "fs/promises";
import path from "path";
import mcpAuditHandler from "./mcp-audit.js";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function emptySummary() {
  return {
    totalUrls: 0,
    scored: 0,
    avgMcpScore: 0,
    readinessBands: {
      mcpReady: 0,
      partiallyReady: 0,
      emerging: 0,
      notReady: 0
    },
    primarySignalCoverage: {
      toolRegistry: 0,
      openapi: 0,
      aiPlugin: 0
    }
  };
}

function summarize(results, totalUrls) {
  const summary = emptySummary();
  summary.totalUrls = totalUrls;

  const ok = results.filter(r => r && r.success === true && typeof r?.mcp?.score === "number");
  summary.scored = ok.length;

  const scoreTotal = ok.reduce((acc, r) => acc + Number(r.mcp.score || 0), 0);
  summary.avgMcpScore = Number((scoreTotal / (ok.length || 1)).toFixed(2));

  for (const r of ok) {
    const band = r?.mcp?.band;
    if (band === "mcp-ready") summary.readinessBands.mcpReady++;
    else if (band === "partially-ready") summary.readinessBands.partiallyReady++;
    else if (band === "emerging") summary.readinessBands.emerging++;
    else summary.readinessBands.notReady++;

    if (r?.signals?.primary?.toolRegistry?.detected) summary.primarySignalCoverage.toolRegistry++;
    if (r?.signals?.primary?.openapi?.detected) summary.primarySignalCoverage.openapi++;
    if (r?.signals?.primary?.aiPlugin?.detected) summary.primarySignalCoverage.aiPlugin++;
  }

  return summary;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    const datasetName = (req.query.dataset || "core-web").toLowerCase();
    const safeDataset = datasetName.replace(/[^a-z0-9\-]/g, "");

    const filePath = path.join(process.cwd(), "data", `${safeDataset}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);

    const urls = Array.isArray(dataset.urls) ? dataset.urls : [];

    const results = [];
    const errors = [];

    for (const url of urls) {
      await sleep(400);

      let out = null;

      try {
        const fakeReq = {
          query: { url },
          method: "GET",
          headers: { origin: "mcp-batch-runner" }
        };

        const fakeRes = {
          status() { return this; },
          json(obj) { out = obj; return obj; },
          setHeader() {}
        };

        await mcpAuditHandler(fakeReq, fakeRes);

        if (!out || out.success !== true) {
          throw new Error(out?.error || "MCP audit returned invalid payload");
        }

        results.push(out);
      } catch (err) {
        const fail = {
          success: false,
          url,
          error: err.message || "Unhandled MCP batch exception"
        };

        errors.push(fail);
        results.push(fail);
      }
    }

    const summary = summarize(results, urls.length);

    return res.status(200).json({
      success: true,
      dataset: safeDataset,
      vertical: dataset.vertical || safeDataset,
      summary,
      results,
      errors,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "MCP batch run failed",
      details: err.message || String(err)
    });
  }
}
