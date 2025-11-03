// ✅ exmxc | API: Single-Page Audit
import * as cheerio from "cheerio"; // fixed import
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("title").text() || "No title found";
    const description =
      $('meta[name="description"]').attr("content") || "No description found";
    const canonical =
      $('link[rel="canonical"]').attr("href") ||
      url.replace(/\/$/, "");

    const data = {
      status: "✅ Audit Complete",
      title,
      description,
      canonical,
      url,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(data);
  } catch (err) {
    console.error("Audit Error:", err);
    res
      .status(500)
      .json({ error: "Server error", details: err.message || err.toString() });
  }
}
