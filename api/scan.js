// /api/scan.js — EEI v3.4 (Rendered Batch Mode + Safe Fallback + Schema Guards)
import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";

export default async function handler(req, res) {
  // --- CORS ---
  const origin = req.headers.origin || req.headers.referer;
  let normalizedOrigin = "*";

  if (origin && origin !== "null") {
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      normalizedOrigin = "*";
    }
  }

  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.status(200).end();

  res.setHeader("Content-Type", "application/json");

  try {
    // --- Load dataset ---
    const filePath = path.join(process.cwd(), "data", "core-web.json");
    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);
    const urls = dataset.urls || [];

    const results = [];

    for (const url of urls) {
      try {
        // Create in-process request for auditHandler
        const fakeReq = {
          query: { url },
          headers: { origin: "http://localhost" },
          method: "GET",
        };

        let output;
        const fakeRes = {
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(obj) {
            output = obj;
            return obj;
          },
          setHeader() {},
        };

        // --- Run audit ---
        await auditHandler(fakeReq, fakeRes);

        // --- Normalize output ---
        if (output?.success) {
          // Guaranteed-safe schemaMeta
          const safeSchemaMeta = {
            schemaBlocks: output.schemaMeta?.schemaBlocks ?? 0,
            latestISO: output.schemaMeta?.latestISO ?? null,
            mode: output.schemaMeta?.mode ?? "static",
            rendered: output.schemaMeta?.rendered ?? false,
            renderError: output.schemaMeta?.renderError ?? null,
          };

          results.push({
            ...output,
            schemaMeta: safeSchemaMeta,
          });
        } else {
          // Failure object
          results.push({
            url,
            success: false,
            error: output?.error || "Audit failed",
            schemaMeta: {
              schemaBlocks: 0,
              latestISO: null,
              mode: "static",
              rendered: false,
              renderError: output?.renderError || null,
            },
          });
        }
      } catch (err) {
        // Hard crash fallback
        results.push({
          url,
          success: false,
          error: err?.message || "Internal error",
          schemaMeta: {
            schemaBlocks: 0,
            latestISO: null,
            mode: "static",
            rendered: false,
            renderError: err?.message || null,
          },
        });
      }
    }

    // --- Aggregate safely ---
    const scored = results.filter((r) => r?.entityScore !== undefined);
    const avgEntityScore =
      scored.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (scored.length || 1);

    const avgSchemaBlocks =
      results.reduce(
        (sum, r) => sum + (r.schemaMeta?.schemaBlocks ?? 0),
        0
      ) / (results.length || 1);

    return res.status(200).json({
      success: true,
      model: "EEI v3.4 (AI-Rendered Batch Mode + Safe Fallback)",
      dataset: dataset.vertical || "Unknown",
      totalUrls: urls.length,
      audited: scored.length,
      avgEntityScore: Number(avgEntityScore.toFixed(2)) || 0,
      avgSchemaBlocks: Number(avgSchemaBlocks.toFixed(2)) || 0,
      siteScore: Math.round(avgEntityScore) || 0,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("EEI Batch Fatal:", err);
    return res.status(500).json({
      error: "Failed to run batch scan",
      details: err?.message || String(err),
    });
  }
}
