// /api/batch-run.js
// EEI Batch Runner v5.5 — EXECUTIVE SUMMARY MODE
// Policy: batch = thin summary only, single audit = full forensics

import axios from "axios";
import { saveDriftSnapshot } from "../lib/drift-db.js";

const AUDIT_ENDPOINT =
  "https://exmxc-audit.vercel.app/api/audit";

/* ============================================================
   MAIN HANDLER
   ============================================================ */

export default async function handler(req, res) {
  try {
    const dataset = req.query?.dataset;
    if (!dataset) {
      return res.status(400).json({
        success: false,
        error: "Missing dataset"
      });
    }

    /* ========================================================
       DATASET REGISTRY
       ======================================================== */

    const DATASETS = {
      "tg-strategic": [
        "https://www.trailgenic.com",
        "https://www.exmxc.ai",
        "https://www.lineps.com",
        "https://www.athletechnews.com"
      ]
    };

    const urls = DATASETS[dataset];
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Unknown or empty dataset"
      });
    }

    /* ========================================================
       BATCH EXECUTION
       ======================================================== */

    const results = [];
    let audited = 0;
    let failed = 0;

    for (const url of urls) {
      try {
        const resp = await axios.get(AUDIT_ENDPOINT, {
          params: { url },
          timeout: 60000
        });

        const out = resp.data;

        /* ====================================================
           ✅ THIN RESULT (SAFE FOR SCALE)
           ==================================================== */
        if (out && out.success) {
          results.push({
            url: out.url,
            hostname: out.hostname,
            entityName: out.entityName,
            entityScore: out.entityScore,
            entityStage: out.entityStage,
            entityVerb: out.entityVerb,
            entityFocus: out.entityFocus,
            entityComprehensionMode: out.entityComprehensionMode
          });
          audited++;
        } else {
          failed++;
        }

      } catch (err) {
        failed++;
      }
    }

    /* ========================================================
       SCORE AGGREGATION
       ======================================================== */

    const avgEntityScore =
      results.length > 0
        ? Math.round(
            results.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
              results.length *
              10
          ) / 10
        : null;

    /* ========================================================
       DRIFT SNAPSHOT (THIN)
       ======================================================== */

    await saveDriftSnapshot(dataset, {
      timestamp: new Date().toISOString(),
      dataset,
      totalUrls: urls.length,
      audited,
      failed,
      avgEntityScore,
      results: results.map(r => ({
        url: r.url,
        entityScore: r.entityScore
      }))
    });

    /* ========================================================
       RESPONSE
       ======================================================== */

    return res.status(200).json({
      success: true,
      vertical: dataset,
      dataset,
      totalUrls: urls.length,
      audited,
      failed,
      avgEntityScore,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Batch run failed",
      details: err.message || String(err)
    });
  }
}
