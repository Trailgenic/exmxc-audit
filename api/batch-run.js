// /api/batch-run.js — EEI v5 Batch Runner

import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.status(200).end();

  res.setHeader("Content-Type", "application/json");

  try {
    // ?dataset=core-media → /data/core-media.json
    let datasetKey = (req.query?.dataset || "core-web").toString().trim();
    if (!/^[a-z0-9\-]+$/i.test(datasetKey)) {
      datasetKey = "core-web";
    }

    const filePath = path.join(process.cwd(), "data", `${datasetKey}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);
    const urls = dataset.urls || [];

    const results = [];

    for (const url of urls) {
      try {
        let out = null;

        const fakeReq = {
          query: { url },
          headers: { origin: "http://localhost" },
          method: "GET",
        };

        const fakeRes = {
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(obj) {
            out = obj;
            return obj;
          },
          setHeader() {},
        };

        await auditHandler(fakeReq, fakeRes);

        if (out && out.success) {
          results.push(out);
        } else {
          results.push({
            url,
            success: false,
            error: out?.error || "EEI v5 audit failed",
          });
        }
      } catch (err) {
        results.push({
          url,
          success: false,
          error: err.message || "Internal error in batch-run",
        });
      }
    }

    const scored = results.filter(
      (r) => r.success && typeof r.v5Score === "number"
    );

    const avg =
      scored.reduce((sum, r) => sum + (r.v5Score || 0), 0) /
      (scored.length || 1);

    const avgScore = Number(avg.toFixed(2));
    const siteScore = Math.round(avgScore);

    return res.status(200).json({
      success: true,
      model: "EEI v5 (batch)",
      dataset: dataset.vertical || datasetKey,
      totalUrls: urls.length,
      audited: scored.length,
      avgScore,
      siteScore,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("EEI v5 Batch Error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to run EEI v5 batch",
      details: err.message || String(err),
    });
  }
}
