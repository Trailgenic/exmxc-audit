// /api/predictive-audit.js — Modular v3.0
// Batch EEI runner: loads URLs from /data/core-web.json → audits → composite output

import axios from "axios";
import coreSites from "../data/core-web.json" assert { type: "json" };

// Base URL (auto-resolves for local or deployed)
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const urls = Array.isArray(coreSites?.urls)
      ? coreSites.urls
      : Object.values(coreSites).flat();

    if (!urls || urls.length === 0) {
      return res.status(400).json({ error: "No URLs found in core-web.json" });
    }

    const results = [];
    for (const url of urls) {
      try {
        const response = await axios.get(`${BASE_URL}/api/audit`, {
          params: { url },
          timeout: 25000,
        });
        results.push({ url, ...response.data });
      } catch (err) {
        results.push({
          url,
          error: err.response?.data?.error || err.message || "Request failed",
        });
      }
    }

    // --- Aggregate analysis ---
    const valid = results.filter((r) => r.entityScore !== undefined);
    const avgEntityScore =
      valid.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (valid.length || 1);
    const avgSchemaBlocks =
      valid.reduce((sum, r) => sum + (r.schemaMeta?.schemaBlocks || 0), 0) /
      (valid.length || 1);

    const compositeScore = Math.round(
      Math.min(avgEntityScore * 0.9 + avgSchemaBlocks * 2, 100)
    );

    const summary = {
      compositeScore,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaBlocks: Math.round(avgSchemaBlocks),
      totalSites: urls.length,
      successful: valid.length,
      failed: urls.length - valid.length,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json({
      success: true,
      summary,
      results,
    });
  } catch (err) {
    console.error("Predictive Audit Error:", err.message);
    res.status(500).json({
      error: "Failed to run predictive audit",
      details: err.message,
    });
  }
}
