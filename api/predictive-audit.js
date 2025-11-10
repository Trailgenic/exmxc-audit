import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const datasetPath = path.join(process.cwd(), "data", "core-web.json");
    const resultsPath = path.join(process.cwd(), "data", "core-web-results.json");

    if (!fs.existsSync(datasetPath)) {
      return res.status(404).json({ error: "Missing core-web.json dataset" });
    }

    const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
    const urls = dataset.urls || [];

    let totalScore = 0;
    let validCount = 0;
    let blockedCount = 0;
    const results = [];

    for (const url of urls) {
      console.log(`🔍 Auditing ${url}`);
      try {
        // Add header spoofing to bypass bot-blockers
        const response = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
          },
          timeout: 10000,
        });

        const $ = cheerio.load(response.data);

        const title = $("title").text() || "N/A";
        const description =
          $('meta[name="description"]').attr("content") || "N/A";
        const canonical =
          $('link[rel="canonical"]').attr("href") || "N/A";

        // crude mini scoring model for demonstration
        let siteScore = 0;
        if (title !== "N/A") siteScore += 20;
        if (description !== "N/A") siteScore += 20;
        if (canonical !== "N/A") siteScore += 10;

        totalScore += siteScore;
        validCount++;

        results.push({
          url,
          title,
          description,
          canonical,
          siteScore,
          status: "ok",
        });

      } catch (err) {
        blockedCount++;
        results.push({
          url,
          error:
            err.response?.status === 403
              ? "Audit endpoint blocked (403)"
              : err.code === "ECONNABORTED"
              ? "Timeout"
              : err.message,
        });
      }

      // throttle between requests to mimic human browsing
      await new Promise((r) => setTimeout(r, 800));
    }

    const avgEntityScore = validCount ? (totalScore / validCount).toFixed(2) : 0;
    const summary = {
      success: true,
      dataset: dataset.vertical,
      totalUrls: urls.length,
      validCount,
      blockedCount,
      avgEntityScore,
      timestamp: new Date().toISOString(),
      results,
    };

    // Save to results file (append mode)
    fs.writeFileSync(
      resultsPath,
      JSON.stringify(summary, null, 2),
      "utf8"
    );

    return res.status(200).json(summary);
  } catch (error) {
    console.error("Predictive audit failed:", error);
    return res
      .status(500)
      .json({ error: "Predictive audit failed", details: error.message });
  }
}
