// /api/batch-status.js — EEI Batch Job Status
// Used by UI polling + report generation

import { getJob } from "../lib/jobs-db.js";

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

    const successful = job.results.filter(
      (r) => r && typeof r.entityScore === "number"
    );

    const avgScore =
      successful.reduce((sum, r) => sum + r.entityScore, 0) /
      (successful.length || 1);

    return res.status(200).json({
      success: true,
      jobId: job.jobId,
      dataset: job.dataset,
      vertical: job.vertical,
      status: job.status,

      totalUrls: job.urls.length,
      processed: job.cursor,
      audited: successful.length,
      failed: job.errors.length,

      avgEntityScore: Number(avgScore.toFixed(2)),
      results: job.results,
      errors: job.errors,

      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Failed to read job status",
      details: err.message,
    });
  }
}

