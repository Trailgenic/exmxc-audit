// /api/predictive-audit.js
import axios from "axios";
import fs from "fs";
import path from "path";
import { CURRENT_WEIGHTS, FUTURE_WEIGHTS } from "../shared/weights.js";

// --- basic helpers
const normalize = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

// --- simulate predictive drift (future bias)
function projectEEI(currentScore) {
  const driftFactor = 1.05; // +5% uplift for structured/AI-ready entities
  const projected = Math.min(100, Math.round(currentScore * driftFactor));
  const resilience = Number((projected / 100).toFixed(2));
  return { projected, resilience };
}

export default async function handler(req, res) {
  try {
    let urls = [];

    // 🔹 Option A: vertical preloaded
    if (req.method === "GET" && req.query.vertical) {
      const file = path.join(process.cwd(), "data", `${req.query.vertical}.json`);
      if (!fs.existsSync(file)) {
        return res
          .status(404)
          .json({ error: `Vertical file not found: ${req.query.vertical}` });
      }
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      urls = data.urls || [];
    }

    // 🔹 Option B: POST body override
    if (req.method === "POST") {
      const body = await new Promise((resolve) => {
        let str = "";
        req.on("data", (chunk) => (str += chunk));
        req.on("end", () => resolve(JSON.parse(str || "{}")));
      });
      urls = body.urls || [];
    }

    if (!Array.isArray(urls) || urls.length === 0) {
      return res
        .status(400)
        .json({ error: "No URLs provided or invalid format" });
    }

    const results = [];
    for (const raw of urls) {
      const url = normalize(raw);
      try {
        const resp = await axios.get(
          `${process.env.VERCEL_URL || "https://exmxc-audit.vercel.app"}/api/audit`,
          { params: { url }, timeout: 20000 }
        );

        const current = resp.data.entityScore || 0;
        const { projected, resilience } = projectEEI(current);

        results.push({
          url,
          EEI_current: current,
          EEI_projected: projected,
          EntityResilienceScore: resilience
        });
      } catch (err) {
        results.push({
          url,
          error: err.message || "Audit failed"
        });
      }
    }

    // --- aggregate summary
    const valid = results.filter((r) => !r.error);
    const avgCurrent =
      valid.reduce((s, r) => s + (r.EEI_current || 0), 0) / (valid.length || 1);
    const avgProjected =
      valid.reduce((s, r) => s + (r.EEI_projected || 0), 0) / (valid.length || 1);
    const avgResilience =
      valid.reduce((s, r) => s + (r.EntityResilienceScore || 0), 0) /
      (valid.length || 1);

    res.status(200).json({
      success: true,
      vertical: req.query.vertical || "custom",
      totalUrls: urls.length,
      audited: valid.length,
      averages: {
        EEI_current: Math.round(avgCurrent),
        EEI_projected: Math.round(avgProjected),
        EntityResilienceScore: Number(avgResilience.toFixed(2))
      },
      results,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Predictive audit error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
