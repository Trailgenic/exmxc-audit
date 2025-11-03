// ✅ exmxc | API: Full-Site Crawl Audit
import * as cheerio from "cheerio"; // fixed import
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    const visited = new Set();
    const results = [];

    async function crawl(currentUrl, depth = 0) {
      if (depth > 1 || visited.has(currentUrl)) return;
      visited.add(currentUrl);

      const response = await fetch(currentUrl);
      if (!response.ok) return;

      const html = await response.text();
      const $ = cheerio.load(html);

      const title = $("title").text();
      const description = $('meta[name="description"]').attr("content") || "";
      const canonical = $('link[rel="canonical"]').attr("href") || currentUrl;

      results.push({ url: currentUrl, title, description, canonical });

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (
          href &&
          href.startsWith("/") &&
          !href.includes("#") &&
          !href.startsWith("mailto:")
        ) {
          const nextUrl = new URL(href, url).href;
          crawl(nextUrl, depth + 1);
        }
      });
    }

    await crawl(url);
    res.status(200).json({
      status: "✅ Full-site crawl complete",
      pagesCrawled: results.length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Full Crawl Error:", err);
    res
      .status(500)
      .json({ error: "Server error", details: err.message || err.toString() });
  }
}
