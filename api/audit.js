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

    // Fetch
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
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "No description found";
    const schemaCount = $("script[type='application/ld+json']").length;

    // 🧠 Recalibrated clarity-weighted scoring
    let score = 0;

    if (title && title.length > 0) score += 25; // baseline presence
    if (description && description.length > 0) score += 25; // clarity metadata
    if (canonical && canonical.length > 0) score += 10; // index control
    if (schemaCount > 0) score += Math.min(schemaCount * 10, 40); // entity structure bonus

    // Normalize to 100 max
    const entityScore = Math.min(score, 100);

    // Diagnostic tier
    let clarityTier;
    if (entityScore >= 90) clarityTier = "Elite — Full AI Clarity";
    else if (entityScore >= 70) clarityTier = "Moderate — Partial AI Clarity";
    else clarityTier = "Weak — High Risk of Misinterpretation";

    // Return results
    return res.status(200).json({
      url,
      title,
      canonical,
      description,
      schemaCount,
      entityScore,
      clarityTier,
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
