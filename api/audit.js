import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    let { url, maxPages } = req.query;
    if (!url || typeof url !== "string" || url.trim() === "")
      return res.status(400).json({ error: "Missing URL" });

    // Normalize URL
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const baseDomain = new URL(url).origin;
    const limit = Math.min(parseInt(maxPages) || 10, 50); // cap at 50 for safety

    const visited = new Set();
    const pages = [];

    // Utility: fetch and parse one page
    const crawlPage = async (pageUrl) => {
      if (visited.has(pageUrl) || !pageUrl.startsWith(baseDomain)) return;
      visited.add(pageUrl);

      try {
        const { data: html } = await axios.get(pageUrl, {
          timeout: 15000,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; exmxc-audit/1.1; +https://exmxc.ai)",
            Accept: "text/html",
          },
        });

        const $ = cheerio.load(html);
        const title = $("title").first().text().trim();
        const canonical = $('link[rel="canonical"]').attr("href") || pageUrl;
        const description =
          $('meta[name="description"]').attr("content") ||
          $('meta[property="og:description"]').attr("content") ||
          "";
        const schemaCount = $("script[type='application/ld+json']").length;

        const entityScore =
          (title ? 30 : 0) +
          (description ? 30 : 0) +
          (canonical ? 10 : 0) +
          Math.min(schemaCount * 10, 30);

        pages.push({ pageUrl, title, canonical, description, schemaCount, entityScore });

        // collect internal links for additional crawl
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          if (href && href.startsWith("/") && !href.includes("#")) {
            const abs = new URL(href, baseDomain).href;
            if (!visited.has(abs)) toVisit.push(abs);
          }
        });
      } catch (err) {
        console.error("Error crawling:", pageUrl, err.message);
      }
    };

    // Breadth-first crawl up to `limit`
    const toVisit = [url];
    while (toVisit.length && visited.size < limit) {
      const next = toVisit.shift();
      await crawlPage(next);
    }

    // Aggregate results
    const totalPages = pages.length;
    const avgEntityScore =
      totalPages > 0
        ? pages.reduce((sum, p) => sum + p.entityScore, 0) / totalPages
        : 0;
    const avgSchemaCount =
      totalPages > 0
        ? pages.reduce((sum, p) => sum + p.schemaCount, 0) / totalPages
        : 0;

    const result = {
      domain: baseDomain,
      pagesCrawled: totalPages,
      avgEntityScore: Number(avgEntityScore.toFixed(1)),
      avgSchemaCount: Number(avgSchemaCount.toFixed(2)),
      timestamp: new Date().toISOString(),
      pages,
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("Audit error:", err.message);
    return res.status(500).json({ error: "Site audit failed", details: err.message });
  }
}
