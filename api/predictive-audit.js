import fs from "fs";
import path from "path";
import axios from "axios";
import cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const dataset = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "core-web.json"), "utf8")
    );

    const results = [];
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
          (title ? 30 : 0) + (description !== "N/A" ? 30 : 0) + (canonical !== "N/A" ? 40 : 0);

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

    const avgScore =
      results.reduce((sum, r) => sum + (r.entityScore || 0), 0) / results.length;

    const summary = {
      success: true,
      dataset: dataset.vertical,
      totalUrls: dataset.urls.length,
      avgEntityScore: avgScore.toFixed(2),
      results,
      timestamp: new Date().toISOString(),
    };

    // ✅ Write to temporary directory (allowed on Vercel)
    const tmpPath = path.join("/tmp", "core-web-results.json");
    fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2), "utf8");
    console.log(`✅ Results saved temporarily to ${tmpPath}`);

    res.status(200).json(summary);
  } catch (err) {
    res.status(500).json({
      error: "Predictive audit failed",
      details: err.message,
    });
  }
}
