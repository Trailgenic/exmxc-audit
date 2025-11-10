import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio"; // ✅ FIX: no default export

export default async function handler(req, res) {
  try {
    // --- Safe path resolution for Vercel ---
    const dataPath = path.resolve("./data/core-web.json");

    if (!fs.existsSync(dataPath)) {
      throw new Error(`core-web.json not found at ${dataPath}`);
    }

    const dataset = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const results = [];

    // --- Crawl each URL sequentially ---
    for (const site of dataset.urls) {
      try {
        const { data } = await axios.get(site, { timeout: 10000 });
        const $ = cheerio.load(data);

        const title = $("title").text().trim();
        const description =
          $('meta[name="description"]').attr("content") || "N/A";
        const canonical =
          $('link[rel="canonical"]').attr("href") || "N/A";

        const entityScore =
          (title ? 30 : 0) +
          (description !== "N/A" ? 30 : 0) +
          (canonical !== "N/A" ? 40 : 0);

        results.push({
          url: site,
          title,
          description,
          canonical,
          entityScore,
        });
      } catch (err) {
        results.push({ url: site, error: err.message });
      }
    }

    // --- Compute average ---
    const avgScore =
      results.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      results.length;

    const summary = {
      success: true,
      dataset: dataset.vertical,
      totalUrls: dataset.urls.length,
      avgEntityScore: avgScore.toFixed(2),
      results,
      timestamp: new Date().toISOString(),
    };

    // --- Safe writable path for Vercel ---
    const tmpPath = "/tmp/core-web-results.json";
    fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2), "utf8");
    console.log(`✅ Results saved to ${tmpPath}`);

    res.status(200).json(summary);
  } catch (err) {
    console.error("Predictive audit failed:", err.message);
    res.status(500).json({
      error: "Predictive audit failed",
      details: err.message,
    });
  }
}
