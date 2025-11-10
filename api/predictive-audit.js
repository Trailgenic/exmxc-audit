// /api/predictive-audit.js — Phase 3 Predictive Intelligence (Option A: Persistent Data)
// Loads pre-baked core-web.json dataset and runs EEI batch audit

import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* ================================
   CONFIG
   ================================ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, "../data/core-web.json");
const HISTORY_PATH = "/tmp/core-web-results.json";

const BASE_URL =
  process.env.VERCEL_URL?.startsWith("http")
    ? process.env.VERCEL_URL
    : `https://${process.env.VERCEL_URL || "exmxc-audit.vercel.app"}`;

const TIMEOUT = 20000; // 20 s per site

/* ================================
   HELPERS
   ================================ */

async function loadCoreWeb() {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf-8");
    const json = JSON.parse(raw);
    if (!Array.isArray(json) || json.length === 0) {
      throw new Error("core-web.json is empty or invalid.");
    }
    return json;
  } catch (err) {
    console.error("❌ Failed to load core-web.json:", err);
    throw err;
  }
}

async function saveResults(payload) {
  try {
    await fs.writeFile(
      HISTORY_PATH,
      JSON.stringify(payload, null, 2),
      "utf-8"
    );
    console.log("✅ Saved batch results to", HISTORY_PATH);
  } catch (err) {
    console.error("⚠️ Failed to write history file:", err);
  }
}

/* ================================
   MAIN HANDLER
   ================================ */

export default async function handler(req, res) {
  // --- CORS ---
  const origin = req.headers.origin || req.headers.referer;
  let normalizedOrigin = "*";
  if (origin && origin !== "null") {
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      normalizedOrigin = "*";
    }
  }
  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (normalizedOrigin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.status(200).end();
  res.setHeader("Content-Type", "application/json");

  try {
    // --- Load dataset ---
    const sites = await loadCoreWeb();
    console.log(`🧩 Running Predictive EEI for ${sites.length} entities...`);

    const results = [];
    for (const site of sites) {
      const url = site.url || site;
      try {
        const response = await axios.get(`${BASE_URL}/api/audit`, {
          params: { url },
          timeout: TIMEOUT,
        });
        results.push({
          url,
          entityScore: response.data.entityScore,
          entityTier: response.data.entityTier,
          schemaBlocks: response.data.schemaMeta?.schemaBlocks || 0,
        });
      } catch (err) {
        console.error(`❌ Failed: ${url}`, err.message);
        results.push({
          url,
          error: err.response?.data?.error || err.message,
        });
      }
    }

    // --- Aggregate metrics ---
    const valid = results.filter((r) => !r.error);
    const avgEntityScore =
      valid.reduce((s, r) => s + (r.entityScore || 0), 0) /
      (valid.length || 1);
    const avgSchemaCount =
      valid.reduce((s, r) => s + (r.schemaBlocks || 0), 0) /
      (valid.length || 1);

    // Future-weighted drift (example formula)
    const driftFactor = 1.12; // simulated 2026+ crawler weighting
    const projectedScore = Math.min(
      Math.round(avgEntityScore * driftFactor),
      100
    );

    // Entity Resilience Score (normalized variance)
    const variance =
      valid.reduce(
        (sum, r) => sum + Math.pow((r.entityScore || 0) - avgEntityScore, 2),
        0
      ) / (valid.length || 1);
    const resilience = Math.max(
      0,
      Math.min(100, 100 - Math.sqrt(variance)))
      .toFixed(1);

    const payload = {
      success: true,
      totalSites: sites.length,
      audited: valid.length,
      failed: sites.length - valid.length,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaCount: Math.round(avgSchemaCount),
      projectedEEI: projectedScore,
      entityResilienceScore: resilience,
      results,
      timestamp: new Date().toISOString(),
    };

    // --- Save to tmp for record (Option A persistence) ---
    await saveResults(payload);

    return res.status(200).json(payload);
  } catch (err) {
    console.error("💥 Predictive Audit Error:", err);
    return res.status(500).json({
      error: "Predictive audit failed",
      details: err.message || String(err),
    });
  }
}
