// /api/batch-run.js — EEI v5.4 Unified Batch Endpoint + Drift History
// Contract-safe with verticals.json + audit.js
// No re-crawling logic. No aggregation here. Orchestration only.

import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";
import { saveDriftSnapshot } from "../lib/drift-db.js";

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

    for (const url of urls) {
      // ⏳ pacing to avoid serverless socket churn
      await new Promise((r) => setTimeout(r, 750));

      let out = null;

      try {
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
            error: out?.details || out?.error || "EEI audit failed",
          });
        }
      } catch (err) {
        results.push({
          url,
          success: false,
          error: err.message || "Unhandled audit exception",
        });
      }
    }

    const successful = results.filter(
      (r) => r && r.success && typeof r.entityScore === "number"
    );

    const avgScore =
      successful.reduce((sum, r) => sum + r.entityScore, 0) /
      (successful.length || 1);

    const payload = {
      vertical: dataset.vertical || safeDataset,
      dataset: safeDataset,
      totalUrls: urls.length,
      audited: successful.length,
      failed: urls.length - successful.length,
      avgEntityScore: Number(avgScore.toFixed(2)),
      results,
      timestamp: new Date().toISOString(),
    };

    saveDriftSnapshot(payload.vertical, payload)
  .catch(err => {
    console.warn("Drift snapshot failed:", err.message);
  });


    return res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Batch run failed",
      details: err.message,
    });
  }
}
