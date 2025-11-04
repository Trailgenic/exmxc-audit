import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    let { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing URL" });

    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "exmxc-audit/1.0" },
    });

    const $ = cheerio.load(html);
    const title = $("title").first().text().trim() || "No title found";
    const canonical = $('link[rel="canonical"]').attr("href") || url;
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

    return res.status(200).json({
      url,
      title,
      canonical,
      description,
      schemaCount,
      entityScore,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Failed to fetch or parse page", details: err.message });
  }
}
