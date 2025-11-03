// exmxc | Stable Single-Page Audit (final baseline)
const axios = require("axios");
const cheerio = require("cheerio");

module.exports = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing URL parameter" });

    const { data: html, headers } = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5
    });
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || null;
    const metaDesc = $('meta[name="description"]').attr("content") || null;
    const canonical = $('link[rel="canonical"]').attr("href") || null;
    const ldCount = $('script[type=\"application/ld+json\"]').length;

    let score = 0;
    if (ldCount > 0) score += 40;
    if (canonical) score += 30;
    if (metaDesc) score += 20;
    if (title) score += 10;

    res.status(200).json({
      auditedAt: new Date().toISOString(),
      target: url,
      httpContentType: headers["content-type"] || null,
      pageTitle: title,
      entityScore: score,
      checks: {
        ldJsonCount: ldCount,
        canonical,
        metaDescPresent: !!metaDesc
      }
    });
  } catch (err) {
    console.error("Audit Error:", err.message);
    res.status(500).json({
      error: "Audit failed",
      details: err.message || "Unexpected error"
    });
  }
};
