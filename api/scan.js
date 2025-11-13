// ==========================
// exmxc.ai | Fortress Batch Mode v3.2
// Proxy Relay Enabled
// ==========================

import fs from "fs";
import path from "path";
import axios from "axios";

export default async function handler(req, res) {
  try {
    const dataPath = path.resolve("./data/core-web.json");
    if (!fs.existsSync(dataPath)) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    const dataset = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const results = [];

    // --- Internal base URL ---
    const base =
      process.env.VERCEL_URL?.startsWith("http")
        ? process.env.VERCEL_URL
        : `https://${process.env.VERCEL_URL || "exmxc-audit.vercel.app"}`;

    const isLocal =
      process.env.NODE_ENV === "development" ||
      base.includes("localhost") ||
      base.includes("127.0.0.1");

    // --- Internal auth token (for safe relay) ---
    const API_KEY = process.env.AUDIT_KEY || "exmxc-internal";

    const UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/3.2 Safari/537.36";

    for (const site of dataset.urls) {
      const target = site.startsWith("http") ? site : `https://${site}`;

      try {
        // --- use local call if running dev ---
        const auditUrl = isLocal
          ? `http://localhost:3000/api/audit`
          : `${base}/api/audit`;

        const { data } = await axios.get(auditUrl, {
          params: { url: target },
          headers: {
            "User-Agent": UA,
            Accept: "application/json,text/html",
            "x-exmxc-key": API_KEY,
          },
          timeout: 25000,
        });

        results.push({
          url: target,
          success: true,
          entityScore: data.entityScore || 0,
          schemaCount: data.schemaCount || 0,
          entityTier: data.entityTier || "N/A",
        });
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

    // --- Aggregate scoring ---
    const valid = results.filter((r) => r.success);
    const avgEntityScore =
      valid.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (valid.length || 1);
    const avgSchemaBlocks =
      valid.reduce((sum, r) => sum + (r.schemaCount || 0), 0) /
      (valid.length || 1);

    const siteScore = Math.min(
      Math.round(avgEntityScore * 0.9 + avgSchemaBlocks * 3),
      100
    );

    res.status(200).json({
      success: true,
      model: "EEI v3.2 (Schema > Scale + Proxy Relay)",
      dataset: dataset.vertical,
      totalUrls: dataset.urls.length,
      audited: valid.length,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaBlocks: Math.round(avgSchemaBlocks),
      siteScore,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Batch scan error:", err.message);
    res.status(500).json({
      error: "Batch scan failed",
      details: err.message,
    });
  }
}
