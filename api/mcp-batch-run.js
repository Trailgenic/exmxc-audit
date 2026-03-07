// /api/mcp-batch-run.js
// MCP Readiness Scanner — batch orchestrator

import fs from "fs/promises";
import path from "path";
import { runMcpAudit } from "./mcp-audit.js";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeDomain(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;

  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./i, "");
    return `https://${host}`;
  } catch {
    return null;
  }
}

function deriveInspectionStatus(result) {
  const errorText = String(result?.error || "").toLowerCase();
  const deniedByError = /403|forbidden|challenge|access denied|blocked/.test(errorText);

  const primary = result?.signals?.primary || {};
  const statuses = [
    primary?.toolRegistry?.status,
    primary?.openapi?.status,
    primary?.aiPlugin?.status,
    primary?.mcpManifest?.status
  ].filter(v => Number.isFinite(v));

  if (result?.success === false) return deniedByError ? "Blocked" : "Blocked";
  if (!statuses.length) return "Blocked";

  const blockedCount = statuses.filter(s => s === 403).length;
  const nonBlockedCount = statuses.filter(s => s !== 403).length;

  if (blockedCount > 0 && nonBlockedCount > 0) return "Partial";
  if (blockedCount > 0) return "Blocked";
  return "Reachable";
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
    },
    inspectionStatus: {
      reachable: 0,
      partial: 0,
      blocked: 0
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

  for (const result of results) {
    const inspectionStatus = String(result?.inspectionStatus || deriveInspectionStatus(result)).toLowerCase();
    if (inspectionStatus === "reachable") summary.inspectionStatus.reachable++;
    else if (inspectionStatus === "partial") summary.inspectionStatus.partial++;
    else summary.inspectionStatus.blocked++;
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

      const displayUrl = url;
      const scanUrl = normalizeDomain(url);

      try {
        if (!scanUrl) {
          throw new Error("Invalid URL in dataset");
        }

        const out = await runMcpAudit(scanUrl);

        if (!out || out.success !== true) {
          throw new Error(out?.error || "MCP audit returned invalid payload");
        }

        out.url = displayUrl;
        out.display_url = displayUrl;
        out.scan_url = scanUrl;
        out.inspectionStatus = deriveInspectionStatus(out);
        results.push(out);
      } catch (err) {
        const fail = {
          success: false,
          url: displayUrl,
          display_url: displayUrl,
          scan_url: scanUrl || null,
          error: err.message || "Unhandled MCP batch exception"
        };

        fail.inspectionStatus = deriveInspectionStatus(fail);
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
