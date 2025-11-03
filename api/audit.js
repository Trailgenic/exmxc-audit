// /api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    // Throws if invalid
    new URL(u);
    return u.replace(/\s+/g, "");
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS (safe no-op for same-origin, helpful for future)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Read url from GET ?url=... OR POST { url: "..." }
    let url =
      req.method === "POST"
        ? (typeof req.body === "string"
            ? (() => {
                try { return JSON.parse(req.body)?.url; } catch { return null; }
              })()
            : req.body?.url)
        : req.query?.url;

    url = normalizeUrl(url);
    if (!url) return res.status(400).json({ error: "Missing or invalid URL" });

    // Fetch the page like a real browser (helps bypass simple bot filters)
    const { data: html } = await axios.get(url, {
      timeout: 12000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      // Some hosts block compressed responses badly; axios handles most, but just in case:
      decompress: true,
      validateStatus: (s) => s >= 200 && s < 400, // allow redirects handled by maxRedirects
    });

    // Parse with Cheerio
    const $ = cheerio.load(html || "");

    const title = $("title").first().text().trim() || "No title found";
    const canonical =
      $('link[rel="canonical"]').attr("href")?.trim() || url.replace(/\/$/, "");
    const description =
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim() ||
      "No description found";

    const schemaCount = $("script[type='application/ld+json']").length;

    // Simple score (tweak later)
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
    console.error("Audit error:", err?.message || err);
    return res
      .status(500)
      .json({ error: "Failed to fetch or parse page", details: err?.message });
  }
}
