// ✅ exmxc | Stable Single-Page Audit (original working CommonJS version)
const axios = require("axios");
const cheerio = require("cheerio");

module.exports = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    // Fetch the page
    const { data: html, headers } = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5
    });

    const $ = cheerio.load(html);

    // Extract core signals
    const title = $("title").text().trim() || null;
    const metaDesc = $('meta[name="description"]').attr("content") || null;
    const canonical = $('link[rel="canonical"]').attr("href") || null;
    const ldCount = $('script[type="application/ld+json"]').length;

    // Compute Entity Score
    let score = 0;
    if (ldCount > 0) score += 40;
    if (canonical) score += 30;
    if (metaDesc) score += 20;
    if (title) score += 10;

    const issues = [];
    if (ldCount === 0) issues.push("No JSON-LD schema found");
    if (!canonical) issues.push("Missing canonical link");
    if (!metaDesc) issues.push("No meta description");

    // Output structured report
    const report = {
      auditedAt: new Date().toISOString(),
      target: url,
      httpContentType: headers["content-type"] || null,
      pageTitle: title,
      entityScore: score,
      checks: {
        ldJsonCount: ldCount,
        canonical,
        metaDescPresent: !!metaDesc
      },
      issues,
      recommendations: [
        ldCount === 0
          ? "Add Organization/Person/Product JSON-LD as appropriate."
          : null,
        !canonical
          ? 'Add <link rel="canonical" href="..."> pointing to your primary URL.'
          : null,
        !metaDesc ? "Add a concise meta description (120–160 chars)." : null
      ].filter(Boolean)
    };

    return res.status(200).json(report);
  } catch (err) {
    console.error("Audit Error:", err.message);
    return res.status(500).json({
      error: "Audit failed",
      details: err.message || "Unexpected error"
    });
  }
};
