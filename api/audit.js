// api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    let { url } = req.query;

    if (!url || typeof url !== "string" || url.trim() === "") {
      return res.status(400).json({ error: "Missing URL" });
    }

    // Normalize (prepend https:// if missing)
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    // Fetch page
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; exmxc-audit/1.0; +https://exmxc.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
      validateStatus: () => true, // prevent axios from throwing for 404/500
    });

    if (response.status >= 400 || !response.data) {
      return res.status(200).json({
        error: `Site returned status ${response.status}`,
        message: "The page could not be retrieved or is blocking the request.",
      });
    }

    const html = response.data;

    // Detect non-HTML responses (like redirects or scripts)
    if (typeof html !== "string" || !html.includes("<html")) {
      return res.status(200).json({
        error: "Non-HTML response received",
        message: "Target did not return a parseable HTML document.",
      });
    }

    // Parse DOM
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim() || "";
    const canonical = $('link[rel="canonical"]').attr("href") || "";
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const schemaCount = $("script[type='application/ld+json']").length;

    // Scoring
    let score = 0;
    if (title) score += 25;
    if (description) score += 25;
    if (canonical) score += 10;
    if (schemaCount > 0) score += Math.min(schemaCount * 10, 40);

    const entityScore = Math.min(score, 100);

    let clarityTier;
    if (entityScore >= 90) clarityTier = "Elite — Full AI Clarity";
    else if (entityScore >= 70) clarityTier = "Moderate — Partial AI Clarity";
    else clarityTier = "Weak — High Risk of Misinterpretation";

    // Respond safely
    return res.status(200).json({
      url,
      title: title || "No title found",
      canonical: canonical || "No canonical link found",
      description: description || "No description found",
      schemaCount,
      entityScore,
      clarityTier,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Audit error:", err.message);
    return res.status(500).json({
      error: "Unexpected processing failure",
      details: err.message,
    });
  }
}
