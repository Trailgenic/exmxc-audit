// ✅ exmxc | Audit Function (Node 20-compatible, no email dependency)

import * as cheerio from "cheerio";
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    // Fetch the target HTML
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract core SEO and structured data info
    const title = $("title").text() || "N/A";
    const description = $('meta[name="description"]').attr("content") || "N/A";
    const canonical = $('link[rel="canonical"]').attr("href") || "N/A";
    const schemaCount = $('script[type="application/ld+json"]').length;
    const ogTitle = $('meta[property="og:title"]').attr("content") || "N/A";
    const ogDescription = $('meta[property="og:description"]').attr("content") || "N/A";

    // Return JSON audit report
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
