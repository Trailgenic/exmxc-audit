// /api/batch-worker.js
// EEI Batch Worker v1.1 — SERIAL + COOLDOWN SAFE
// Processes small slices of a batch job without timing out
// Designed for hostile / bot-protected domains (finance, insurance)

import { getBatchJob, updateBatchJob } from "../lib/batch-db.js";
import auditHandler from "./audit.js";

/* ============================================================
   CONFIG (LOCK THESE)
   ============================================================ */

const MAX_WORKER_MS = 240000; // 4 minutes hard cap
const CRAWL_COOLDOWN_MS = 20000; // 20s cooldown between crawls

/* ============================================================
   UTILS
   ============================================================ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ============================================================
   MAIN WORKER
   ============================================================ */

export default async function handler(req, res) {
  try {
    const jobId = req.query?.jobId;
    if (!jobId) {
      return res.status(400).json({ error: "Missing jobId" });
    }

    const job = await getBatchJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Do not re-run completed jobs
    if (job.status === "completed") {
      return res.status(200).json({
        success: true,
        status: "completed",
        message: "Job already completed",
      });
    }

    const startedAt = Date.now();
    let cursor = job.cursor || 0;

    const results = job.results || [];
    const urls = job.urls || [];

    while (cursor < urls.length) {
      // ⛔ Time guard (never 504)
      if (Date.now() - startedAt > MAX_WORKER_MS) break;

      const url = urls[cursor];

      let auditResult = null;

      try {
        // --- Fake req/res to reuse audit handler ---
        const fakeReq = {
          query: { url },
          headers: {},
          method: "GET",
        };

        let jsonPayload = null;

        const fakeRes = {
          status: () => fakeRes,
          json: (data) => {
            jsonPayload = data;
            return data;
          },
          setHeader: () => {},
        };

        await auditHandler(fakeReq, fakeRes);

        auditResult = jsonPayload;
      } catch (err) {
        auditResult = {
          success: false,
          url,
          error: err.message || "Audit execution failed",
        };
      }

      // --- Store THIN result ---
      results.push({
        success: auditResult?.success || false,
        url,
        hostname: auditResult?.hostname || null,
        entityName: auditResult?.entityName || null,
        entityScore: auditResult?.entityScore || null,
        entityStage: auditResult?.entityStage || null,
        entityVerb: auditResult?.entityVerb || null,
        entityFocus: auditResult?.entityFocus || null,
        canonical: auditResult?.canonical || null,
        entityComprehensionMode:
          auditResult?.entityComprehensionMode || "unknown",
      });

      cursor++;

      // ⏳ CRITICAL: cooldown to protect crawl-worker
      await sleep(CRAWL_COOLDOWN_MS);
    }

    const completed = cursor >= urls.length;

    await updateBatchJob(jobId, {
      cursor,
      results,
      status: completed ? "completed" : "running",
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      jobId,
      processed: cursor,
      total: urls.length,
      status: completed ? "completed" : "running",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Batch worker failure",
      details: err.message || String(err),
    });
  }
}
