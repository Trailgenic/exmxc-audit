// api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // Set JSON response header FIRST (prevents HTML error pages)
  res.setHeader("Content-Type", "application/json");
  
  try {
    let { url } = req.query;

    if (!url || typeof url !== "string" || url.trim() === "") {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    // Normalize URL (add https:// if missing)
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    // Fetch page
    let html;
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; exmxc-audit/1.0; +https://exmxc.ai)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        maxRedirects: 5,
      });
      html = response.data;
    } catch (fetchError) {
      return res.status(500).json({
        error: "Failed to fetch URL",
        details: fetchError.message,
        url: url,
      });
    }

    // Parse HTML
    const $ = cheerio.load(html);
    
    const title = $("title").first().text().trim() || "No title found";
    const canonical = $('link[rel="canonical"]').attr("href") || url;
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "No description found";
    const schemaScripts = $("script[type='application/ld+json']");
    const schemaCount = schemaScripts.length;

    // Calculate entity score
    const entityScore =
      (title !== "No title found" ? 30 : 0) +
      (description !== "No description found" ? 30 : 0) +
      (canonical !== url ? 10 : 0) +
      Math.min(schemaCount * 10, 30);

    return res.status(200).json({
      success: true,
      url,
      title,
      canonical,
      description,
      schemaCount,
      entityScore,
      timestamp: new Date().toISOString(),
    });
    
  } catch (err) {
    console.error("Audit error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
}
