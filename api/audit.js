import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    let { url } = req.query;
    if (!url || typeof url !== "string" || url.trim() === "") {
      return res.status(400).json({ error: "Missing URL" });
    }

    // --- Normalize + validate
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const origin = new URL(url).origin;
    const visited = new Set();
    const pages = [];
    const queue = [url];
    const MAX_PAGES = 30;

    // --- Crawl loop
    while (queue.length && pages.length < MAX_PAGES) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      try {
        const { data: html, headers } = await axios.get(current, {
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; exmxc-audit/2.0; +https://exmxc.ai)",
            Accept: "text/html",
          },
        });

        if (!headers["content-type"]?.includes("text/html")) continue;

        const $ = cheerio.load(html);
        const title = $("title").first().text().trim() || "No title found";
        const canonical =
          $('link[rel="canonical"]').attr("href") || current;
        const description =
          $('meta[name="description"]').attr("content") ||
          $('meta[property="og:description"]').attr("content") ||
          "No description found";
        const schemaCount = $("script[type='application/ld+json']").length;

        const entityScore =
          (title ? 30 : 0) +
          (description ? 30 : 0) +
          (canonical ? 10 : 0) +
          Math.min(schemaCount * 10, 30);

        pages.push({
          pageUrl: current,
          title,
          canonical,
          description,
          schemaCount,
          entityScore,
        });

        // --- Find internal links for next crawl
        $("a[href]").each((_, el) => {
          let link = $(el).attr("href");
          if (!link) return;
          if (link.startsWith("/")) link = origin + link;
          if (link.startsWith(origin) && !visited.has(link)) {
            queue.push(link);
          }
        });
      } catch (err) {
        console.warn(`Skipped ${current}: ${err.message}`);
      }
    }

    // --- Compute stats
    const avgEntityScore =
      pages.reduce((sum, p) => sum + p.entityScore, 0) /
      (pages.length || 1);
    const avgSchemaCount =
      pages.reduce((sum, p) => sum + p.schemaCount, 0) /
      (pages.length || 1);
    const internalLinkDensity = Math.min(
      (pages.length / MAX_PAGES) * 1.0,
      1.0
    );
    const entityGraphStrength = Math.round(
      avgEntityScore * 0.6 + avgSchemaCount * 10 + internalLinkDensity * 30
    );

    // --- Return full result
    return res.status(200).json({
      domain: origin,
      pagesCrawled: pages.length,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaCount: parseFloat(avgSchemaCount.toFixed(1)),
      entityGraphStrength,
      timestamp: new Date().toISOString(),
      pages,
    });
  } catch (err) {
    console.error("Audit error:", err.message);
    return res.status(500).json({
      error: "Failed to crawl or analyze site",
      details: err.message,
    });
  }
}
