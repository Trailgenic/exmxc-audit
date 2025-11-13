// /api/scan.js — EEI v3.1 Predictive Fortress Edition
import fs from "fs";
import path from "path";
import axios from "axios";

export default async function handler(req, res) {
  try {
    // --- Load dataset (default: Core Web)
    const datasetPath = path.resolve("./data/core-web.json");

    if (!fs.existsSync(datasetPath)) {
      throw new Error(`Dataset not found at ${datasetPath}`);
    }

    const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
    const urls = dataset.urls || [];

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Dataset is empty or invalid." });
    }

    const normalize = (url) =>
      /^https?:\/\//i.test(url) ? url : `https://${url}`;

    const results = [];
    const apiBase = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://exmxc-audit.vercel.app";

    for (const rawUrl of urls) {
      const url = normalize(rawUrl);
      try {
        const response = await axios.get(`${apiBase}/api/audit`, {
          params: { url },
          timeout: 25000,
        });

        const data = response.data || {};
        results.push({
          url,
          entityScore: data.entityScore || 0,
          entityStage: data.entityStage || data.entityTier || "—",
          entityVerb: data.entityVerb || "—",
          entityDescription: data.entityDescription || "—",
          schemaBlocks: data.schemaMeta?.schemaBlocks || 0,
          success: true,
        });

        console.log(
          `[EEI] ${url} → ${data.entityScore} (${data.entityStage || data.entityTier})`
        );
      } catch (err) {
        results.push({
          url,
          error:
            err.response?.data?.error ||
            err.message ||
            "Audit fetch failed or site blocked",
          success: false,
        });
      }
    }

    // --- Aggregate stats ---
    const valid = results.filter((r) => r.success);
    const avgEntityScore =
      valid.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (valid.length || 1);

    const avgSchemaCount =
      valid.reduce((sum, r) => sum + (r.schemaBlocks || 0), 0) /
      (valid.length || 1);

    const siteScore = Math.min(
      Math.round(avgEntityScore * 0.9 + avgSchemaCount * 3),
      100
    );

    const summary = {
      success: true,
      model: "EEI v3.1 (Schema > Scale)",
      dataset: dataset.vertical || "Core Web",
      totalUrls: urls.length,
      audited: valid.length,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaBlocks: Math.round(avgSchemaCount),
      siteScore,
      timestamp: new Date().toISOString(),
      results,
    };

    // --- Save to /tmp for Vercel inspection ---
    const tmpPath = "/tmp/scan-results.json";
    fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2));
    console.log(`✅ Predictive scan results saved to ${tmpPath}`);

    res.status(200).json(summary);
  } catch (err) {
    console.error("Predictive scan error:", err.message);
    res.status(500).json({
      error: "Failed to run predictive scan",
      details: err.message,
    });
  }
}
