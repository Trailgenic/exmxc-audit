import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    let { url } = req.query;

    if (!url || typeof url !== "string" || url.trim() === "") {
      return res.status(400).json({ error: "Missing URL" });
    }

    // Normalize (prepend https:// if missing)
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Validate
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    // Fetch target HTML
    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; exmxc-audit/1.0; +https://exmxc.ai)",
        Accept: "text/html",
      },
    });

    // Parse
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim() || "No title found";
    const canonical = $('link[rel="canonical"]').attr("href") || url;
    const description =
      $('meta[name='description']").attr("content") ||
      $('meta[property='og:description']").attr("content") ||
      "No description found";
    const schemaCount = $("script[type='application/ld+json']").length;

    // 🧮 Recalibrated Scoring Model (New)
    let entityScore = 0;

    if (schemaCount > 0) entityScore += 40; // Core trust layer
    if (description && description !== "No description found") entityScore += 30;
    if (canonical) entityScore += 20;
    if (title && title !== "No title found") entityScore += 10;

    // Penalties for incomplete signals
    if (schemaCount < 2) entityScore -= 10;
    if (!(schemaCount && description && canonical)) entityScore -= 20;

    // Clamp between 0–100
    entityScore = Math.max(0, Math.min(100, entityScore));

    return res.status(200).json({
      url,
      title,
      canonical,
      description,
      schemaCount,
      entityScore,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Audit error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch or parse page",
      details: err.message,
    });
  }
}
