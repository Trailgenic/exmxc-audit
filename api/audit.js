// ✅ Stable Single Page Audit
const cheerio = require("cheerio");
const fetch = require("node-fetch");

module.exports = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing URL parameter" });

    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Failed to fetch URL: ${response.statusText}`);

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("title").text() || "No title found";
    const description =
      $('meta[name="description"]').attr("content") || "No description found";
    const canonical =
      $('link[rel="canonical"]').attr("href") || url.replace(/\/$/, "");

    res.status(200).json({
      status: "✅ Audit Complete",
      title,
      description,
      canonical,
      url,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message || err.toString(),
    });
  }
};
