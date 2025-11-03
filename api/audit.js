// ✅ exmxc | Audit Function (Native Fetch, No External Packages)

import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    // ✅ Use native fetch (Node 18+ / 20+)
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url} — ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract basic metadata + schema
    const title = $("title").text() || "N/A";
    const description = $('meta[name="description"]').attr("content") || "N/A";
    const canonical = $('link[rel="canonical"]').attr("href") || "N/A";
    const schemaCount = $('script[type="application/ld+json"]').length;
    const ogTitle = $('meta[property="og:title"]').attr("content") || "N/A";
    const ogDescription = $('meta[property="og:description"]').attr("content") || "N/A";

    // Return a simple structured audit result
    return res.status(200).json({
      status: "ok",
      site: url,
      title,
      description,
      canonical,
      schemaCount,
      ogTitle,
      ogDescription,
      auditedAt: new Date().toISOString(),
      poweredBy: "exmxc.ai",
      agent: "Ella | Entity Engineering Audit Node"
    });

  } catch (error) {
    console.error("Audit Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
