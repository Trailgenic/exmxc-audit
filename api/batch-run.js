// /api/batch-run.js — EEI v5 Unified Batch Endpoint + Drift History

import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";
import { saveDriftSnapshot } from "../lib/drift-db.js";   // MUST be at top for ESM

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    // ---------------------------
    // 1) Read dataset, default "core-web"
    // ---------------------------
    const datasetName = req.query.dataset?.toLowerCase() || "core-web";

    // Sanitize input (no traversal)
    const safeDataset = datasetName.replace(/[^a-z0-9\-]/g, "");

    // ---------------------------
    // 2) Resolve dataset file path
    // ---------------------------
    const filePath = path.join(process.cwd(), "data", `${safeDataset}.json`);

    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);

    const urls = dataset.urls || [];
    const results = [];

    // ---------------------------
    // 3) Loop through URLs
    // ---------------------------
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
            error: out?.error || "EEI audit failed",
          });
        }
      } catch (err) {
        results.push({
          url,
          success: false,
          error: err.message,
        });
      }
    }

    // ---------------------------
    // 4) Scoring (V5 entityScore)
    // ---------------------------
    const scored = results.filter(
      (r) => r && r.success && typeof r.entityScore === "number"
    );

    const avg =
      scored.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (scored.length || 1);

    const payload = {
      vertical: dataset.vertical || safeDataset,
      totalUrls: urls.length,
      audited: scored.length,
      avgEntityScore: Number(avg.toFixed(2)),
      results,
      timestamp: new Date().toISOString(),
    };

    // ---------------------------
    // 5) Save drift snapshot
    // ---------------------------
    await saveDriftSnapshot(payload.vertical, payload);

    return res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Batch run failed",
      details: err.message,
    });
  }
}
