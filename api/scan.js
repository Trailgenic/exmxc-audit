import fs from "fs";
import path from "path";
import axios from "axios";

export default async function handler(req, res) {
  try {
    // Allow selecting datasets, default to core-web
    const { dataset = "core-web" } = req.query;

    // ✅ Correct path: keep everything under /data
    const corePath = path.join(process.cwd(), `data/${dataset}.json`);

    if (!fs.existsSync(corePath)) {
      return res.status(400).json({
        error: "Dataset not found",
        details: `Missing file: data/${dataset}.json`,
      });
    }

    const { urls = [] } = JSON.parse(fs.readFileSync(corePath, "utf8"));
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Dataset has no URLs" });
    }

    const base = process.env.AUDIT_BASE_URL || `https://${req.headers.host}`;
    const toAbs = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

    const results = [];
    for (const raw of urls) {
      const url = toAbs(raw);
      try {
        const r = await axios.get(`${base}/api/audit`, {
          params: { url },
          timeout: 20000,
          headers: { "User-Agent": "exmxc-batch/1.0" },
          validateStatus: (s) => s >= 200 && s < 500,
        });
        results.push({ url, ...(r.data || {}) });
      } catch (e) {
        results.push({
          url,
          success: false,
          error: e?.response?.data?.error || e?.message || "Request failed",
        });
      }
    }

    const valids = results.filter((r) => r.success);
    const avgEntityScore =
      valids.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (valids.length || 1);
    const avgSchemaBlocks =
      valids.reduce((sum, r) => sum + (r.schemaMeta?.schemaBlocks || 0), 0) /
      (valids.length || 1);

    // Simple composite for display; tune later
    const siteScore = Math.min(
      Math.round(avgEntityScore * 0.9 + avgSchemaBlocks * 2),
      100
    );

    return res.status(200).json({
      success: true,
      model: "EEI v3.2 (Schema > Scale + Proxy Relay)",
      dataset: dataset.replace("-", " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      totalUrls: urls.length,
      audited: valids.length,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaBlocks: Math.round(avgSchemaBlocks),
      siteScore,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to run site scan",
      details: err?.message || String(err),
    });
  }
}
