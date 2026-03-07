// /api/mcp-batch-run.js
// MCP Readiness Scanner — batch orchestrator

import fs from "fs/promises";
import path from "path";
import { runMcpAudit } from "./mcp-audit.js";

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 10;
const DEFAULT_PER_DOMAIN_TIMEOUT_MS = 15000;
const DEFAULT_DEADLINE_MS = 275000; // leave headroom under Vercel 300s hard limit

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

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return fallback;
  return Math.floor(n);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    })
  ]);
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

async function runSingleAudit(displayUrl, perDomainTimeoutMs) {
  const scanUrl = normalizeDomain(displayUrl);

  if (!scanUrl) {
    const fail = {
      success: false,
      url: displayUrl,
      display_url: displayUrl,
      scan_url: null,
      error: "Invalid URL in dataset"
    };
    fail.inspectionStatus = deriveInspectionStatus(fail);
    return fail;
  }

  const out = await withTimeout(
    runMcpAudit(scanUrl),
    perDomainTimeoutMs,
    () => new Error(`MCP audit timed out after ${perDomainTimeoutMs}ms`)
  );

  if (!out || out.success !== true) {
    throw new Error(out?.error || "MCP audit returned invalid payload");
  }

  out.url = displayUrl;
  out.display_url = displayUrl;
  out.scan_url = scanUrl;
  out.inspectionStatus = deriveInspectionStatus(out);

  if (out.inspectionStatus === "Blocked" && out.mcp && typeof out.mcp === "object") {
    out.mcp.score = null;
    out.mcp.band = "unobserved";
  }

  return out;
}

async function runBatchAudits(urls, options = {}) {
  const results = [];
  const errors = [];
  const concurrency = clamp(parsePositiveInt(options.concurrency, DEFAULT_CONCURRENCY), 1, MAX_CONCURRENCY);
  const perDomainTimeoutMs = parsePositiveInt(options.perDomainTimeoutMs, DEFAULT_PER_DOMAIN_TIMEOUT_MS);
  const deadlineMs = parsePositiveInt(options.deadlineMs, DEFAULT_DEADLINE_MS);
  const startedAt = Date.now();

  let processed = 0;
  let timedOut = false;

  for (let i = 0; i < urls.length; i += concurrency) {
    if (Date.now() - startedAt >= deadlineMs) {
      timedOut = true;
      break;
    }

    const slice = urls.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      slice.map(displayUrl => runSingleAudit(displayUrl, perDomainTimeoutMs))
    );

    settled.forEach((entry, idx) => {
      processed += 1;

      if (entry.status === "fulfilled") {
        const result = entry.value;
        results.push(result);
        if (result.success === false) errors.push(result);
        return;
      }

      const displayUrl = slice[idx];
      const scanUrl = normalizeDomain(displayUrl);
      const fail = {
        success: false,
        url: displayUrl,
        display_url: displayUrl,
        scan_url: scanUrl || null,
        error: entry.reason?.message || "Unhandled MCP batch exception"
      };
      fail.inspectionStatus = deriveInspectionStatus(fail);
      errors.push(fail);
      results.push(fail);
    });
  }

  return {
    results,
    errors,
    meta: {
      processed,
      totalRequested: urls.length,
      timedOut,
      remaining: Math.max(urls.length - processed, 0),
      concurrency,
      perDomainTimeoutMs,
      deadlineMs
    }
  };
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

    const offset = clamp(parsePositiveInt(req.query.offset, 0), 0, urls.length);
    const limit = parsePositiveInt(req.query.limit, urls.length - offset);
    const boundedLimit = clamp(limit, 1, Math.max(urls.length - offset, 1));
    const targetUrls = urls.slice(offset, offset + boundedLimit);

    const { results, errors, meta } = await runBatchAudits(targetUrls, {
      concurrency: req.query.concurrency,
      perDomainTimeoutMs: req.query.perDomainTimeoutMs,
      deadlineMs: req.query.deadlineMs
    });

    const summary = summarize(results, targetUrls.length);

    return res.status(200).json({
      success: true,
      dataset: safeDataset,
      vertical: dataset.vertical || safeDataset,
      summary,
      results,
      errors,
      timestamp: new Date().toISOString(),
      paging: {
        offset,
        limit: boundedLimit,
        nextOffset: offset + meta.processed,
        hasMore: offset + meta.processed < urls.length,
        totalDatasetUrls: urls.length
      },
      runtime: meta
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "MCP batch run failed",
      details: err.message || String(err)
    });
  }
}
