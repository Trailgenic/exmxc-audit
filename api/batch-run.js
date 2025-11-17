// /api/batch-run.js — EEI v4.0 Batch UI Endpoint
import fs from "fs/promises";
import path from "path";
import auditHandler from "./audit.js"; // directly call internal audit

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    // Load the vertical dataset
    const filePath = path.join(process.cwd(), "data", "core-web.json");
    const raw = await fs.readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);
    const urls = dataset.urls || [];

    const results = [];

    for (const url of urls) {
      try {
        // Fake req/res
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

        results.push(out?.success ? out : { url, success: false });
      } catch (err) {
        results.push({ url, success: false, error: err.message });
      }
    }

    const scored = results.filter((r) => r.entityScore >= 0);
    const avg =
      scored.reduce((sum, r) => sum + r.entityScore, 0) /
      (scored.length || 1);

    return res.status(200).json({
      success: true,
      vertical: dataset.vertical || "Unknown",
      totalUrls: urls.length,
      audited: scored.length,
      avgEntityScore: Number(avg.toFixed(2)),
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Batch run failed",
      details: err.message || String(err),
    });
  }
}

