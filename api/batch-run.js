// /api/batch-run.js — EEI v5 Unified Batch Endpoint (Dynamic Dataset + Drift History)
import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    // ---------------------------
    // 1) Read dataset, default "core-web"
    // ---------------------------
    const datasetName = req.query.dataset?.toLowerCase() || "core-web";
    const safeDataset = datasetName.replace(/[^a-z0-9\-]/g, "");

    // Dataset load
    const filePath = path.join(process.cwd(), "data", `${safeDataset}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);

    const urls = dataset.urls || [];
    const results = [];

    // ---------------------------
    // 2) Loop through URLs
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
    // 3) Scoring (V5.1 Entity Score)
    // ---------------------------
    const scored = results.filter(
      (r) => r && r.success && typeof r.entityScore === "number"
    );

    const avg =
      scored.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (scored.length || 1);

    // Stage distribution
    const stageCount = { sovereign: 0, structured: 0, visible: 0, emergent: 0 };
    for (const r of scored) {
      const s = r.entityStage || "";
      if (s.includes("☀️")) stageCount.sovereign++;
      else if (s.includes("🌕")) stageCount.structured++;
      else if (s.includes("🌗")) stageCount.visible++;
      else if (s.includes("🌑")) stageCount.emergent++;
    }

    // Top 5 (descending score)
    const top5 = [...scored]
      .sort((a, b) => b.entityScore - a.entityScore)
      .slice(0, 5)
      .map((x) => ({ url: x.url, score: x.entityScore }));

    // Bottom 5 (ascending score)
    const bottom5 = [...scored]
      .sort((a, b) => a.entityScore - b.entityScore)
      .slice(0, 5)
      .map((x) => ({ url: x.url, score: x.entityScore }));

    // ---------------------------
    // 4) DRIFT HISTORY WRITE
    // ---------------------------
    const driftPath = path.join(
      process.cwd(),
      "data",
      "drift-history",
      `${safeDataset}.json`
    );

    let drift = [];
    try {
      const dRaw = await fs.readFile(driftPath, "utf8");
      drift = JSON.parse(dRaw);
    } catch (err) {
      drift = [];
    }

    const snapshot = {
      timestamp: new Date().toISOString(),
      dataset: dataset.vertical || safeDataset,
      avgEntityScore: Number(avg.toFixed(2)),
      totalSites: urls.length,
      sovereign: stageCount.sovereign,
      structured: stageCount.structured,
      visible: stageCount.visible,
      emergent: stageCount.emergent,
      top5,
      bottom5,
    };

    drift.push(snapshot);

    await fs.writeFile(driftPath, JSON.stringify(drift, null, 2), "utf8");

    // ---------------------------
    // 5) Return API Response
    // ---------------------------
    return res.status(200).json({
      success: true,
      vertical: dataset.vertical || safeDataset,
      totalUrls: urls.length,
      audited: scored.length,
      avgEntityScore: Number(avg.toFixed(2)),
      stageDistribution: stageCount,
      top5,
      bottom5,
      results,
      timestamp: snapshot.timestamp,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Batch run failed",
      details: err.message,
    });
  }
}
