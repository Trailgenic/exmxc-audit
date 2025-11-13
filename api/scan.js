// /api/scan.js — EEI v3.2b (Schema > Scale > Proxy Relay + Safe Origin Patch)
import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js"; // internal import (no external HTTP)

export default async function handler(req, res) {
  // --- CORS Handling ---
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
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
        // 🧩 Create fake req/res objects to run auditHandler in-process
        const fakeReq = {
          query: { url },
          headers: { origin: "http://localhost" }, // 👈 added safe fallback
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

        await auditHandler(fakeReq, fakeRes);

        // Handle when auditHandler returns via .json()
        if (output?.success) {
          results.push(output);
        } else {
          results.push({
            url,
            success: false,
            error: output?.error || "Audit failed",
          });
        }
      } catch (err) {
        results.push({
          url,
          success: false,
          error: err.message || "Internal error",
        });
      }
    }

    // --- Aggregate results ---
    const scored = results.filter((r) => r?.entityScore);
    const avgEntityScore =
      scored.reduce((sum, r) => sum + (r.entityScore || 0), 0) / (scored.length || 1);

    return res.status(200).json({
      success: true,
      model: "EEI v3.2 (Schema > Scale + Proxy Relay)",
      dataset: dataset.vertical || "Unknown",
      totalUrls: urls.length,
      audited: scored.length,
      avgEntityScore: Number(avgEntityScore.toFixed(2)) || 0,
      avgSchemaBlocks:
        results.reduce((s, r) => s + (r.schemaMeta?.schemaBlocks || 0), 0) / (results.length || 1),
      siteScore: Math.round(avgEntityScore) || 0,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("EEI Batch Error:", err);
    return res.status(500).json({
      error: "Failed to run site scan",
      details: err.message || String(err),
    });
  }
}
