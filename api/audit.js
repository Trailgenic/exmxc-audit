// api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    let { url } = req.query;

    // --- Step 1: Validation ---
    if (!url || typeof url !== "string" || url.trim() === "") {
      return res.status(400).json({ error: "Missing URL" });
    }

    // Normalize user input (prepend https:// if missing)
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    // Validate the normalized URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Missing or invalid URL" });
    }

    // --- Step 2: Fetch page ---
    const { data: html } = await axios.get(url, {
      timeout: 12000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; exmxc-audit/1.0; +https://exmxc.ai)",
        Accept: "text/html",
      },
    });

    // --- Step 3: Parse page ---
    const $ = cheerio.load(html);

    const title =
      $("title").first().text().trim() || "No title found";
    const canonical =
      $('link[rel="canonical"]').attr("href") ||
      url.replace(/\/$/, "");
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "No description found";

    // --- Step 4: Count schema blocks ---
    const schemaCount = $("script[type='application/ld+json']").length;

    // --- Step 5: Compute Entity Score (basic logic) ---
    const entityScore =
      (title ? 30 : 0) +
      (description ? 30 : 0) +
      (canonical ? 10 : 0) +
      Math.min(schemaCount * 10, 30);

    // --- Step 6: Return result ---
    return res.status(200).json({
      url,
      title,
      canonical,
      description,
      schemaCount,
      entityScore,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Audit error:", error.message);
    return res.status(500).json({
      error: "Failed to fetch or parse page",
      details: error.message,
    });
  }
}
