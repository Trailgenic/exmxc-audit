// /api/batch-worker.js — EEI Async Batch Worker
// Processes ONE chunk per invocation (scale-safe)

import auditHandler from "./audit.js";
import { getJob, updateJob } from "../lib/jobs-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    const jobId = req.query.jobId;
    if (!jobId) {
      return res.status(400).json({ error: "Missing jobId" });
    }

    const job = await getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (job.status === "completed") {
      return res.status(200).json({
        success: true,
        status: "completed",
        message: "Job already completed",
      });
    }

    const start = job.cursor;
    const end = Math.min(start + job.chunkSize, job.urls.length);
    const urls = job.urls.slice(start, end);

    for (const url of urls) {
      let out = null;

      try {
        const fakeReq = {
          query: { url },
          headers: { origin: "http://localhost" },
          method: "GET",
        };

        const fakeRes = {
          status() {
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
          job.results.push({
            success: true,
            url: out.url,
            hostname: out.hostname,
            entityName: out.entityName,
            entityScore: out.entityScore,
            entityStage: out.entityStage,
            entityVerb: out.entityVerb,
            entityFocus: out.entityFocus,
            canonical: out.canonical,
            entityComprehensionMode: out.entityComprehensionMode,
            degradedDiscovery: out.degradedDiscovery,
          });
        } else {
          job.errors.push({
            url,
            error: out?.details || out?.error || "Audit failed",
          });
        }
      } catch (err) {
        job.errors.push({
          url,
          error: err.message || "Unhandled audit exception",
        });
      }
    }

    job.cursor = end;
    job.status = end >= job.urls.length ? "completed" : "running";
    job.updatedAt = new Date().toISOString();

    await updateJob(jobId, () => job);

    return res.status(200).json({
      success: true,
      jobId,
      status: job.status,
      processed: end,
      total: job.urls.length,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Batch worker failed",
      details: err.message,
    });
  }
}

