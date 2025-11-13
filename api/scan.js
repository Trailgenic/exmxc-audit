// /api/scan.js — EEI v3.1 Fortress Edition
import axios from "axios";

export default async function handler(req, res) {
  try {
    let { urls } = req.body;

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
          `${process.env.VERCEL_URL || "https://exmxc-audit.vercel.app"}/api/audit`,
          { params: { url }, timeout: 25000 }
        );

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

        // Optional console log for Vercel dashboard
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
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaBlocks: Math.round(avgSchemaCount),
      siteScore,
      totalUrls: urls.length,
      audited: valid.length,
      timestamp: new Date().toISOString(),
      results,
    };

    res.status(200).json(summary);
  } catch (err) {
    console.error("Site scan error:", err.message);
    res.status(500).json({
      error: "Failed to run site scan",
      details: err.message,
    });
  }
}
