// /api/audit.js
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const config = {
  runtime: "nodejs20.x", // ✅ ensures Node runtime
};

// Main API handler
export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing ?url parameter" });
    }

    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract metadata for audit
    const title = $("title").text() || "No title found";
    const description = $('meta[name="description"]').attr("content") || "No description";
    const canonical = $('link[rel="canonical"]').attr("href") || "No canonical tag";

    const audit = {
      title,
      description,
      canonical,
      url,
      status: "✅ Audit Complete",
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(audit);
  } catch (err) {
    console.error("Audit error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
}
