// api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

// ========= CONFIG =========
const MAX_PAGES = 10; // limit recursive crawl depth
const TIMEOUT = 15000; // 15s per request
// ==========================

export default async function handler(req, res) {
  try {
    let { url } = req.query;

    if (!url || typeof url !== "string" || url.trim() === "")
      return res.status(400).json({ error: "Missing URL" });

    // Normalize URL
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const base = new URL(url);
    const domainRoot = `${base.protocol}//${base.hostname}`;

    const visited = new Set();
    const results = [];

    async function crawlPage(target) {
      if (visited.size >= MAX_PAGES || visited.has(target)) return;
      visited.add(target);

      try {
        const { data: html } = await axios.get(target, {
          timeout: TIMEOUT,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; exmxc-siteaudit/1.0; +https://exmxc.ai)",
            Accept: "text/html",
          },
        });

        const $ = cheerio.load(html);
        const title = $("title").first().text().trim() || "No title found";
        const canonical =
          $('link[rel="canonical"]').attr("href") ||
          `${domainRoot}${new URL(target).pathname}`;
        const description =
          $('meta[name="description"]').attr("content") ||
          $('meta[property="og:description"]').attr("content") ||
          "No description found";
        const schemaCount = $("script[type='application/ld+json']").length;

        // Weighted scoring system (new calibration)
        let entityScore = 0;
        if (title && title !== "No title found") entityScore += 25;
        if (description && description !== "No description found") entityScore += 25;
        if (canonical) entityScore += 10;
        entityScore += Math.min(schemaCount * 10, 40); // bonus for structured data

        results.push({
          pageUrl: target,
          title,
          canonical,
          description,
          schemaCount,
          entityScore,
        });

        // Extract internal links (recursive crawl)
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;

          try {
            const abs = new URL(href, domainRoot).href;
            if (abs.startsWith(domainRoot) && !visited.has(abs)) {
              crawlPage(abs);
            }
          } catch {
            // Ignore invalid URLs
          }
        });
      } catch (err) {
        console.error(`❌ Crawl error for ${target}:`, err.message);
      }
    }

    // Begin recursive crawl
    await crawlPage(domainRoot);

    // Aggregate domain stats
    const avgEntityScore =
      results.reduce((acc, r) => acc + r.entityScore, 0) / results.length || 0;
    const avgSchemaCount =
      results.reduce((acc, r) => acc + r.schemaCount, 0) / results.length || 0;

    return res.status(200).json({
      domain: domainRoot,
      pagesCrawled: results.length,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaCount: Number(avgSchemaCount.toFixed(1)),
      timestamp: new Date().toISOString(),
      pages: results,
    });
  } catch (err) {
    console.error("⚠️ Audit error:", err.message);
    return res.status(500).json({
      error: "Failed to crawl site",
      details: err.message,
    });
  }
}
