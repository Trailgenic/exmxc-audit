import axios from "axios";
import cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const rootUrl = (req.method === "GET" ? req.query.url : req.body?.url)?.trim();
    if (!rootUrl) return res.status(400).json({ error: "Missing url" });

    const visited = new Set();
    const queue = [rootUrl];
    const maxDepth = 2; // Crawl depth limit for now
    const allPages = [];

    while (queue.length) {
      const currentUrl = queue.shift();
      if (visited.has(currentUrl)) continue;
      visited.add(currentUrl);

      try {
        const { data } = await axios.get(currentUrl, { timeout: 10000 });
        const $ = cheerio.load(data);

        const title = $("title").text().trim() || "No title";
        const metaDesc = $('meta[name="description"]').attr("content") || null;
        const ldCount = $('script[type="application/ld+json"]').length;
        const canonical = $('link[rel="canonical"]').attr("href") || null;

        allPages.push({
          url: currentUrl,
          title,
          metaDesc,
          ldCount,
          canonical,
        });

        // Crawl internal links (limit depth)
        if (currentUrl.startsWith(rootUrl)) {
          $("a[href]").each((_, el) => {
            const href = $(el).attr("href");
            if (href && href.startsWith(rootUrl) && !visited.has(href)) {
              queue.push(href);
            }
          });
        }
      } catch (err) {
        allPages.push({ url: currentUrl, error: err.message });
      }
    }

    res.status(200).json({
      status: "✅ Full-site crawl complete",
      totalPages: allPages.length,
      site: rootUrl,
      pages: allPages,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Full crawl failed" });
  }
}
