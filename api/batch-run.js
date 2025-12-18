// /api/batch-run.js — EEI v5.4
// Unified Batch Runner with execution fencing + drift history
// Designed to run safely within serverless limits

import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";
import { saveDriftSnapshot } from "../lib/drift-db.js";

/* ============================================================
   CONFIG — SAFE LIMITS
   ============================================================ */

const MAX_ENTITY_RUNTIME_MS = 30000; // 30s per entity
const MAX_BATCH_RUNTIME_MS = 260000; // ~4.3 minutes total (Vercel-safe)

/* ============================================================
   HELPERS
   ============================================================ */

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

/* ============================================================
   MAIN HANDLER
   ============================================================ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const batchStartedAt = Date.now();

  try {
    /* ---------------------------
       1) Resolve dataset
       --------------------------- */

    const datasetName = req.query.dataset?.toLowerCase() || "core-web";
    const safeDataset = datasetName.replace(/[^a-z0-9\-]/g, "");
    const filePath = path.join(process.cwd(), "data", `${safeDataset}.json`);

    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);

    const urls = Array.isArray(dataset.urls) ? dataset.urls : [];
    const results = [];

    /* ---------------------------
       2) Iterate entities (SEQUENTIAL, FENCED)
       --------------------------- */

    for (const url of urls) {
      const now = Date.now();

      // Batch-level time fence
      if (now - batchStartedAt > MAX_BATCH_RUNTIME_MS) {
        break;
      }

      const startedAt = Date.now();

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

        await withTimeout(
          auditHandler(fakeReq, fakeRes),
          MAX_ENTITY_RUNTIME_MS
        );

        if (out && out.success) {
          results.push({
            ...out,
            status: "success",
            durationMs: Date.now() - startedAt,
          });
        } else {
          results.push({
            url,
            success: false,
            status: "error",
            error: out?.error || "EEI audit failed",
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (err) {
        const reason =
          err.message === "timeout" ? "timeout" : "error";

        results.push({
          url,
          success: false,
          status: reason,
          error:
            reason === "timeout"
              ? `Entity exceeded ${MAX_ENTITY_RUNTIME_MS}ms`
              : err.message,
          durationMs: Date.now() - startedAt,
        });
      }
    }

    /* ---------------------------
       3) Batch scoring
       --------------------------- */

    const scored = results.filter(
      (r) => r && r.success && typeof r.entityScore === "number"
    );

    const avg =
      scored.reduce((sum, r) => sum + r.entityScore, 0) /
      (scored.length || 1);

    const payload = {
      vertical: dataset.vertical || safeDataset,
      totalUrls: urls.length,
      audited: results.length,
      successful: scored.length,
      avgEntityScore: Number(avg.toFixed(2)),
      incomplete:
        Date.now() - batchStartedAt > MAX_BATCH_RUNTIME_MS,
      results,
      timestamp: new Date().toISOString(),
    };

    /* ---------------------------
       4) Drift snapshot
       --------------------------- */

    await saveDriftSnapshot(payload.vertical, payload);

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
