// /api/batch-run.js — EEI v5.5 Unified Batch Endpoint + Drift (SCALE-SAFE)
// Contract-safe with data/*.json + audit.js
// Policy: batch = executive summary; single audit = forensics
// Drift is NON-BLOCKING and THIN (never fails batch)

import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";
import { saveDriftSnapshot } from "../lib/drift-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    /* ============================================================
       1) Resolve dataset
       ============================================================ */

    const datasetName = (req.query.dataset || "core-web").toLowerCase();
    const safeDataset = datasetName.replace(/[^a-z0-9\-]/g, "");
    const filePath = path.join(process.cwd(), "data", `${safeDataset}.json`);

    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);

    const urls = Array.isArray(dataset.urls) ? dataset.urls : [];
    const results = [];

    /* ============================================================
       2) Sequential audit execution (intentional)
       ============================================================ */

    for (const url of urls) {
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

        // ✅ THIN result only (batch-safe)
        if (out && out.success) {
          results.push({
            success: true,
            url: out.url,
            hostname: out.hostname,
            entityName: out.entityName,

            entityScore: out.entityScore,
            entityStage: out.entityStage,
            entityVerb: out.entityVerb,
            entityFocus: out.entityFocus,

            // Helpful at batch level, still light:
            canonical: out.canonical,
            entityComprehensionMode: out.entityComprehensionMode,
            degradedDiscovery: out.degradedDiscovery,
          });
        } else {
          results.push({
            success: false,
            url,
            error: out?.details || out?.error || "EEI audit failed",
          });
        }
      } catch (err) {
        results.push({
          success: false,
          url,
          error: err?.message || "Unhandled audit exception",
        });
      }
    }

    /* ============================================================
       3) Batch-level scoring
       ============================================================ */

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

    /* ============================================================
       4) Drift snapshot (NON-BLOCKING + THIN)
       ============================================================ */

    const driftThin = {
      vertical: payload.vertical,
      dataset: payload.dataset,
      totalUrls: payload.totalUrls,
      audited: payload.audited,
      failed: payload.failed,
      avgEntityScore: payload.avgEntityScore,
      timestamp: payload.timestamp,

      // Thin per-site score only
      results: payload.results
        .filter((r) => r && r.success && typeof r.entityScore === "number")
        .map((r) => ({
          url: r.url,
          entityScore: r.entityScore,
        })),
    };

    // ✅ Never fail the batch if Upstash is flaky
    saveDriftSnapshot(driftThin.vertical, driftThin).catch((err) => {
      console.warn("Drift snapshot failed (ignored):", err?.message || err);
    });

    /* ============================================================
       5) Response
       ============================================================ */

    return res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Batch run failed",
      details: err?.message || String(err),
    });
  }
}
