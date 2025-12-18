// /api/batch-start.js — EEI Async Batch Start
// Creates a job and returns jobId immediately

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { createJob } from "../lib/jobs-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    const datasetName = (req.query.dataset || "").toLowerCase();
    if (!datasetName) {
      return res.status(400).json({ error: "Missing dataset" });
    }

    const safeDataset = datasetName.replace(/[^a-z0-9\-]/g, "");
    const filePath = path.join(process.cwd(), "data", `${safeDataset}.json`);

    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);
    const urls = Array.isArray(dataset.urls) ? dataset.urls : [];

    if (!urls.length) {
      return res.status(400).json({ error: "Dataset has no URLs" });
    }

    const jobId = crypto.randomUUID();

    const job = {
      jobId,
      dataset: safeDataset,
      vertical: dataset.vertical || safeDataset,
      urls,
      cursor: 0,
      chunkSize: 5,
      results: [],
      errors: [],
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await createJob(job);

    return res.status(200).json({
      success: true,
      jobId,
      totalUrls: urls.length,
      status: "queued",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Failed to start batch",
      details: err.message,
    });
  }
}

