// ==============================================
// exmxc.ai | Predictive EEI Audit — Stage 1
// Batch runner for /data/core-web.json
// ==============================================

import axios from "axios";
import fs from "fs";
import path from "path";

// --- stealth UA + headers (mimic human browser)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 exmxc.ai-Audit/3.0";

const STEALTH_HEADERS = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: "https://www.google.com/",
  Connection: "keep-alive",
};

// --- proxy placeholder (Stage 2 upgrade slot)
// const PROXY = { host: "proxy.example.com", port: 8080, auth: { username: "", password: "" } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    // --- load dataset
    const dataPath = path.join(process.cwd(), "data", "core-web.json");
    const raw = fs.readFileSync(dataPath, "utf8");
    const dataset = JSON.parse(raw);
    const urls = dataset.urls || [];

    if (!urls.length) {
      return res
        .status(400)
        .json({ error: "core-web.json is empty or invalid." });
    }

    const results = [];
    let successCount = 0;
    let schemaSum = 0;

    // --- sequential crawl (light concurrency for safety)
    for (const site of urls) {
      const url = site.trim();
      try {
        const resp = await axios.get(url, {
          timeout: 15000,
          maxRedirects: 5,
          headers: STEALTH_HEADERS,
          // proxy: PROXY, // (enable in Stage 2)
          validateStatus: (s) => s < 400,
        });

        const html = resp.data || "";
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : null;
        const descMatch = html.match(
          /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
        );
        const description = descMatch ? descMatch[1].trim() : "";
        const canonicalMatch = html.match(
          /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i
        );
        const canonical = canonicalMatch ? canonicalMatch[1].trim() : url;

        // Count schema blocks
        const schemaCount = (html.match(/application\/ld\+json/g) || []).length;
        schemaSum += schemaCount;

        const score = Math.min(
          100,
          (title ? 20 : 0) +
            (description ? 20 : 0) +
            (canonical ? 10 : 0) +
            Math.min(schemaCount * 10, 50)
        );

        results.push({
          url,
          title,
          description,
          canonical,
          schemaCount,
          score,
        });
        successCount++;
      } catch (err) {
        results.push({
          url,
          error: err.response
            ? `Request failed with status code ${err.response.status}`
            : err.message || "Fetch error",
        });
      }
    }

    // --- composite predictive scoring
    const avgEntityScore =
      results.reduce((sum, r) => sum + (r.score || 0), 0) / (successCount || 1);
    const avgSchemaCount = schemaSum / (successCount || 1);
    const projectedEEI = Math.min(
      100,
      Math.round(avgEntityScore * 0.8 + avgSchemaCount * 5)
    );
    const resilienceScore = successCount
      ? Math.round((successCount / urls.length) * 100)
      : 0;

    return res.status(200).json({
      success: true,
      dataset: dataset.vertical || "Core Web",
      totalSites: urls.length,
      audited: successCount,
      failed: urls.length - successCount,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaCount: Math.round(avgSchemaCount),
      projectedEEI,
      entityResilienceScore: resilienceScore,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Predictive audit error:", err);
    return res.status(500).json({
      error: "Predictive audit failed",
      details: err.message,
    });
  }
}
