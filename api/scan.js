// /api/scan.js — EEI v3.3 Batch Relay (Internal Key Auth)
import axios from "axios";
import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  try {
    // Load dataset from core-web.json
    const corePath = path.join(process.cwd(), "core-web.json");
    const dataset = JSON.parse(fs.readFileSync(corePath, "utf8"));
    const urls = dataset.urls || [];

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Missing or invalid URL list" });
    }

    const normalize = (url) =>
      /^https?:\/\//i.test(url) ? url : `https://${url}`;

    const results = [];

    for (const rawUrl of urls) {
      const url = normalize(rawUrl);
      try {
        const response = await axios.get(
          `${process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "https://exmxc-audit.vercel.app"}/api/audit`,
          {
            params: { url },
            timeout: 25000,
            headers: {
              "x-exmxc-key": "exmxc-internal",
              "User-Agent": "exmxc-batch/3.3",
            },
          }
        );
        results.push({
          url,
          success: true,
          ...response.data,
        });
      } catch (err) {
        results.push({
          url,
          success: false,
          error:
            err.response?.data?.error ||
            err.message ||
            "Unknown error during fetch",
        });
      }
    }

    // --- Aggregate Scoring ---
    const valid = results.filter((r) => r.success && r.entityScore !== undefined);
    const avgEntityScore =
      valid.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (valid.length || 1);
    const avgSchemaBlocks =
      valid.reduce((sum, r) => sum + (r.schemaMeta?.schemaBlocks || 0), 0) /
      (valid.length || 1);

    const siteScore = Math.min(
      Math.round(avgEntityScore * 0.9 + avgSchemaBlocks * 3),
      100
    );

    res.status(200).json({
      success: true,
      model: "EEI v3.3 (Schema > Scale + Proxy Relay)",
      dataset: dataset.vertical || "Core Web",
      totalUrls: urls.length,
      audited: valid.length,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaBlocks: Math.round(avgSchemaBlocks),
      siteScore,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Site scan error:", err.message);
    res.status(500).json({
      error: "Failed to run site scan",
      details: err.message,
    });
  }
}
