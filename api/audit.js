// /api/audit.js
import fetch from "node-fetch";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing ?url parameter" });
    }

    // Fetch and parse HTML
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Collect structured metadata
    const title = $("title").text() || "No title found";
    const description =
      $('meta[name="description"]').attr("content") || "No description";
    const canonical =
      $('link[rel="canonical"]').attr("href") || "No canonical tag";

    const result = {
      status: "✅ Audit Complete",
      title,
      description,
      canonical,
      url,
      timestamp: new Date().toISOString()
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ Audit failed:", err);
    return res.status(500).json({
      error: "Internal Server Error",
      details: err.message
    });
  }
}
