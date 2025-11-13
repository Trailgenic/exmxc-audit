// /api/scan.js — EEI v3.1 Fortress Batch
import fs from "fs";
import path from "path";
import axios from "axios";

export default async function handler(req, res) {
  try {
    const dataPath = path.resolve("./data/core-web.json");
    if (!fs.existsSync(dataPath))
      return res.status(404).json({ error: "Dataset not found" });

    const dataset = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const results = [];

    const UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/3.0 Safari/537.36";

    for (const site of dataset.urls) {
      const target = site.startsWith("http") ? site : `https://${site}`;
      try {
        const { data } = await axios.get(
          `${process.env.VERCEL_URL || "https://exmxc-audit.vercel.app"}/api/audit`,
          {
            params: { url: target },
            headers: {
              "User-Agent": UA,
              Accept: "application/json,text/html",
            },
            timeout: 20000,
          }
        );
        results.push({ url: target, success: true, entityScore: data.entityScore });
      } catch (err) {
        results.push({
          url: target,
          success: false,
          error:
            err.response?.status === 401
              ? "Access denied (401)"
              : err.message || "Fetch failed",
        });
      }
    }

    const valid = results.filter((r) => r.success);
    const avgEntityScore =
      valid.reduce((sum, r) => sum + (r.entityScore || 0), 0) / (valid.length || 1);

    res.status(200).json({
      success: true,
      model: "EEI v3.1 (Schema > Scale)",
      dataset: dataset.vertical,
      totalUrls: dataset.urls.length,
      audited: valid.length,
      avgEntityScore: Math.round(avgEntityScore),
      siteScore: Math.round(avgEntityScore),
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: "Batch scan failed",
      details: err.message,
    });
  }
}
