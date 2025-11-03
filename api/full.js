// ✅ Full-Site Audit built from working single-page pattern
const cheerio = require("cheerio");
const fetch = require("node-fetch");

module.exports = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing URL parameter" });

    const visited = new Set();
    const results = [];

    async function crawlPage(currentUrl, depth = 0) {
      if (depth > 1 || visited.has(currentUrl)) return;
      visited.add(currentUrl);

      const response = await fetch(currentUrl);
      if (!response.ok) return;

      const html = await response.text();
      const $ = cheerio.load(html);

      const title = $("title").text() || "No title found";
      const description =
        $('meta[name="description"]').attr("content") || "No description found";
      const canonical =
        $('link[rel="canonical"]').attr("href") || currentUrl;

      results.push({ url: currentUrl, title, description, canonical });

      // Find internal links
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.startsWith("/") && !href.includes("#")) {
          const nextUrl = new URL(href, url).href;
          crawlPage(nextUrl, depth + 1);
        }
      });
    }

    await crawlPage(url);

    res.status(200).json({
      status: "✅ Full-Site Crawl Complete",
      pages: results.length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message || err.toString(),
    });
  }
};
