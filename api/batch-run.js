// /api/batch-run.js — EEI v6.6 Canonical Batch Orchestrator
// Static-first, state-aware, suppression-safe
// Runs audit.js for each URL — no DB, no workers

import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";
import { saveDriftSnapshot } from "../lib/drift-db.js";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
      // throttle lightly to protect crawl infra
      await sleep(500);

      let out = null;

      try {
        // Reuse audit.js via fake req/res
        const fakeReq = {
          query: { url },
          headers: { origin: "batch-runner" },
          method: "GET",
        };

        const fakeRes = {
          status() { return this; },
          json(obj) { out = obj; return obj; },
          setHeader() {}
        };

        await auditHandler(fakeReq, fakeRes);

        if (!out || out.success !== true) {
          throw new Error(out?.error || "Audit returned invalid payload");
        }

        results.push(out);

      } catch (err) {
        const fail = {
          url,
          success: false,
          error: err.message || "Unhandled audit exception",
        };

        errors.push(fail);
        results.push(fail);
      }
    }

    // ===============================
    // Analytics (ECC + State Summary)
    // ===============================

    const observed = results.filter(r => r.state?.label === "observed");
    const suppressed = results.filter(r => r.state?.label === "suppressed");
    const opaque = results.filter(r => r.state?.label === "opaque");
    const failed = results.filter(r => r.success === false);

    const scored = observed
      .filter(r => typeof r?.ecc?.score === "number");

    const avgECC =
      scored.reduce((sum, r) => sum + r.ecc.score, 0) /
      (scored.length || 1);

    const summary = {
      totalUrls: urls.length,
      observed: observed.length,
      suppressed: suppressed.length,
      opaque: opaque.length,
      failed: failed.length,
      scored: scored.length,
      avgECC: Number(avgECC.toFixed(2)),
    };

    const payload = {
      success: true,
      version: "v6.6",
      vertical: dataset.vertical || safeDataset,
      dataset: safeDataset,
      summary,
      results,
      errors,
      timestamp: new Date().toISOString(),
    };

    // Persist drift snapshot (best-effort)
    saveDriftSnapshot(payload.vertical, payload).catch(err => {
      console.warn("Drift snapshot failed:", err.message);
    });

    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Batch run failed",
      details: err.message,
    });
  }
}
