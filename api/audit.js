// ✅ exmxc | Single-Page Entity Audit
import * as cheerio from "cheerio";
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const url = req.query.url || req.body?.url;
    if (!url) return res.status(400).json({ error: "Missing URL parameter" });

    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Failed to fetch URL: ${response.statusText}`);

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || "No title found";
    const description =
      $('meta[name="description"]').attr("content") || "No description found";
    const canonical =
      $('link[rel=\"canonical\"]').attr("href") || url.replace(/\/$/, "");
    const schemaCount = $('script[type=\"application/ld+json\"]').length;

    const report = {
      status: "✅ Audit Complete",
      url,
      title,
      description,
      canonical,
      schemaCount,
      entityScore:
        (title ? 25 : 0) +
        (description ? 25 : 0) +
        (canonical ? 25 : 0) +
        (schemaCount > 0 ? 25 : 0),
      auditedAt: new Date().toISOString()
    };

    res.status(200).json(report);
  } catch (err) {
    console.error("Audit Error:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
}
