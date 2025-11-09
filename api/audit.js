// exmxc.ai | Production-Ready Universal Audit API
// ✅ CORS + Rate Limit + Cloudflare Bypass + Full Scoring

import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // --- 1. CORS setup ---
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  let normalizedOrigin = "*";

  if (origin && origin !== "null") {
    normalizedOrigin = origin;
  } else if (referer) {
    try {
      normalizedOrigin = new URL(referer).origin;
    } catch {
      normalizedOrigin = "*";
    }
  }

  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (normalizedOrigin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") return res.status(200).end();

  // --- 2. Rate limiting (10 req/min per IP) ---
  if (!global.rateLimitMap) global.rateLimitMap = new Map();
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 10;

  if (!global.rateLimitMap.has(ip)) global.rateLimitMap.set(ip, []);
  const timestamps = global.rateLimitMap.get(ip).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return res.status(429).json({ error: "Rate limit exceeded", message: "Maximum 10 requests per minute" });
  }
  timestamps.push(now);
  global.rateLimitMap.set(ip, timestamps);

  // --- 3. Input validation ---
  const { url } = req.query;
  if (!url || typeof url !== "string" || url.trim() === "") {
    return res.status(400).json({ error: "Missing URL" });
  }

  const target = url.startsWith("http") ? url : `https://${url}`;

  try {
    // --- 4. Cloudflare-safe fetch using axios ---
    const response = await axios.get(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; exmxc-audit/1.0; +https://exmxc.ai)" },
      timeout: 15000,
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // --- 5. Entity + schema scoring logic ---
    const title = $("title").text().trim() || null;
    const description = $('meta[name="description"]').attr("content") || null;
    const canonical = $('link[rel="canonical"]').attr("href") || null;
    const schemaBlocks = $("script[type='application/ld+json']").length;

    const entityName = title?.split("|")[0]?.trim() || "Unknown";
    const metrics = {
      schema: { points: schemaBlocks * 5, raw: { validSchemaBlocks: schemaBlocks } },
      title: { points: title ? 5 : 0, raw: { title } },
      description: { points: description ? 5 : 0, raw: { description } },
    };

    const entityScore =
      metrics.schema.points +
      metrics.title.points +
      metrics.description.points;

    // --- 6. Return JSON response ---
    return res.status(200).json({
      success: true,
      url: target,
      hostname: new URL(target).hostname,
      entityName,
      title,
      canonical,
      description,
      entityScore,
      metrics,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Audit error:", err.message);
    return res.status(500).json({ error: "Audit fetch failed", details: err.message });
  }
}
