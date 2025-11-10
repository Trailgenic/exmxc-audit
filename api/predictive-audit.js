import axios from "axios";
import fs from "fs";
import path from "path";

/* ================================
   CONFIG
   ================================ */

const PROXY_POOL = [
  // free rotation fallback (can expand to paid proxies later)
  "",
  "https://api.allorigins.win/raw?url=",
  "https://corsproxy.io/?",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/3.0 Safari/537.36";

const DATA_FILE = path.resolve("./data/core-web.json");

/* ================================
   HELPERS
   ================================ */

async function fetchWithProxies(url) {
  let lastError = null;
  for (const proxy of PROXY_POOL) {
    try {
      const fullUrl = proxy ? `${proxy}${encodeURIComponent(url)}` : url;
      const resp = await axios.get(fullUrl, {
        timeout: 15000,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      return resp.data;
    } catch (err) {
      lastError = err;
      // try next proxy
    }
  }
  throw lastError || new Error("All proxy attempts failed");
}

/* ================================
   MAIN HANDLER
   ================================ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  res.setHeader("Content-Type", "application/json");

  try {
    // load baked-in dataset
    const dataset = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const urls = dataset.urls;
    const results = [];

    for (const url of urls) {
      try {
        const auditUrl = `${
          process.env.VERCEL_URL || "https://exmxc.ai"
        }/api/audit?url=${encodeURIComponent(url)}`;
        const response = await axios.get(auditUrl, { timeout: 20000 });
        results.push({ url, ...response.data });
      } catch (err) {
        // fallback: try direct proxy fetch to confirm connectivity
        try {
          await fetchWithProxies(url);
          results.push({ url, error: "Audit endpoint blocked but fetchable" });
        } catch {
          results.push({ url, error: err.message || "Fetch failed" });
        }
      }
    }

    // aggregate scoring
    const valid = results.filter((r) => !r.error && r.entityScore);
    const avgScore =
      valid.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (valid.length || 1);

    res.status(200).json({
      success: true,
      dataset: dataset.vertical,
      totalUrls: urls.length,
      validCount: valid.length,
      avgEntityScore: Math.round(avgScore),
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Predictive Audit Error:", err);
    res.status(500).json({
      error: "Predictive audit failed",
      details: err.message,
    });
  }
}
