// /api/batch-run.js — EEI v6.7
// Strategic Posture Batch Orchestrator
// Normalizes to AI-Strategy taxonomy (back-compat safe)

import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";
import { saveDriftSnapshot } from "../lib/drift-db.js";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* -------------------------------
   NORMALIZER — STRATEGY CANONICAL
-------------------------------- */
function normalizeResult(raw) {

  const state =
    raw?.state?.label ??
    raw?.state ??
    raw?.visibility?.state?.value ??
    "opaque";

  const stateReason =
    raw?.state?.reason ??
    raw?.visibility?.suppression?.reason ??
    null;

  const ecc =
    typeof raw?.ecc?.score === "number"
      ? raw.ecc.score
      : typeof raw?.entityScore === "number"
      ? raw.entityScore
      : null;

  const posture =
    raw?.aiStrategy?.posture ??
    null;

  const capability =
    raw?.aiStrategy?.capability ??
    null;

  const intent =
    raw?.aiStrategy?.intent ??
    raw?.intent?.posture ??
    null;

  const quadrant =
    raw?.aiStrategy?.quadrant ??
    raw?.quadrant ??
    null;

  const mode =
    raw?.schemaMeta?.rendered ? "rendered" : "static";

  return {
    url: raw.url,

    // Visibility lens
    state,
    stateReason,

    // Strategic taxonomy
    posture,
    capability,
    intent,
    quadrant,

    // Capability metric
    ecc,

    mode,

    // Keep full raw for diagnostics & reports
    _raw: raw
  };
}

/* ===============================
   HANDLER
================================ */
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

    const rawResults = [];
    const errors = [];

    for (const url of urls) {

      await sleep(500);

      let out = null;

      try {
        const fakeReq = {
          query: { url },
          headers: { origin: "batch-runner" },
          method: "GET"
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

        rawResults.push(out);

      } catch (err) {
        const fail = {
          url,
          success: false,
          error: err.message || "Unhandled audit exception"
        };

        errors.push(fail);
        rawResults.push(fail);
      }
    }

    /* --------------------------------
       NORMALIZE FOR UI + ANALYTICS
    -------------------------------- */
    const results = rawResults.map(r =>
      r.success === false ? r : normalizeResult(r)
    );

    /* ===============================
       STRATEGIC SUMMARY
    =============================== */

    const observed = results.filter(r => r.state === "observed");
    const suppressed = results.filter(r => r.state === "suppressed");
    const opaque = results.filter(r => r.state === "opaque");
    const failed = results.filter(r => r.success === false);

    // posture distribution
    const byPosture = {
      open: results.filter(r => r.posture === "Open / Transparent").length,
      balanced: results.filter(r => r.posture === "Balanced / Selective").length,
      defensive: results.filter(r => r.posture === "Closed / Defensive").length
    };

    // capability distribution
    const byCapability = {
      high: results.filter(r => r.capability === "high").length,
      medium: results.filter(r => r.capability === "medium").length,
      low: results.filter(r => r.capability === "low").length
    };

    const scored = observed.filter(r => typeof r.ecc === "number");

    const avgECC =
      scored.reduce((s, r) => s + r.ecc, 0) /
      (scored.length || 1);

    const summary = {
      totalUrls: urls.length,

      // visibility map
      observed: observed.length,
      suppressed: suppressed.length,
      opaque: opaque.length,
      failed: failed.length,

      // strategy map
      posture: byPosture,
      capability: byCapability,

      // capability metric
      scored: scored.length,
      avgECC: Number(avgECC.toFixed(2))
    };

    const payload = {
      success: true,
      version: "v6.7",
      vertical: dataset.vertical || safeDataset,
      dataset: safeDataset,
      summary,
      results,
      errors,
      timestamp: new Date().toISOString()
    };

    // best-effort drift persistence
    saveDriftSnapshot(payload.vertical, payload).catch(err => {
      console.warn("Drift snapshot failed:", err.message);
    });

    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Batch run failed",
      details: err.message
    });
  }
}
