// /api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing URL parameter" });
  }

  try {
    const { data, headers } = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "exmxc.ai-AuditBot/1.0" },
    });

    // Detect non-HTML (like images, PDFs, etc.)
    if (!headers["content-type"]?.includes("text/html")) {
      return res.json({
        entityScore: 0,
        issues: ["Non-HTML content detected"],
        recommendations: ["Submit a valid webpage URL"],
      });
    }

    const $ = cheerio.load(data);

    const hasJSONLD = $('script[type="application/ld+json"]').length > 0;
    const hasCanonical = $('link[rel="canonical"]').attr("href") ? true : false;
    const hasMetaDesc = $('meta[name="description"]').attr("content") ? true : false;
    const hasTitle = $("title").text().length > 0;

    const entityScore = [hasJSONLD, hasCanonical, hasMetaDesc, hasTitle].filter(Boolean).length * 25;

    res.status(200).json({
      entityScore,
      checks: {
        hasJSONLD,
        hasCanonical,
        hasMetaDesc,
        hasTitle,
      },
      issues: [
        !hasJSONLD && "Missing structured data (JSON-LD)",
        !hasCanonical && "Missing canonical tag",
        !hasMetaDesc && "Missing meta description",
        !hasTitle && "Missing title tag",
      ].filter(Boolean),
    });
  } catch (error) {
    res.status(500).json({
      error: "Audit failed",
      details: error.message || error.toString(),
    });
  }
}
