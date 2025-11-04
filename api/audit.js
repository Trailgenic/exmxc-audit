// exmxc.ai Audit API — Stable v2.1 (Recalibrated Scoring)

import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing ?url parameter" });
    }

    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    const response = await fetch(targetUrl, { timeout: 10000 });
    const html = await response.text();

    // Basic extraction helpers
    const getMeta = (name) => {
      const match = html.match(
        new RegExp(`<meta[^>]*(name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i")
      );
      return match ? match[2] : null;
    };

    // Feature detections
    const hasJSONLD = html.includes('"@context":') && html.includes('"@type"');
    const hasCanonical = html.includes('rel="canonical"');
    const hasTitle = /<title>.*<\/title>/i.test(html);
    const hasMetaDesc = getMeta("description") !== null;
    const schemaCount = (html.match(/"@type"/g) || []).length;

    // Base scoring weights
    let entityScore = 0;
    if (hasJSONLD) entityScore += 40;
    if (hasCanonical) entityScore += 25;
    if (hasMetaDesc) entityScore += 20;
    if (hasTitle) entityScore += 15;

    // Penalties for missing schema structure
    if (schemaCount < 1) entityScore -= 10;

    // Clamp score between 0–100
    entityScore = Math.max(0, Math.min(100, entityScore));

    // Recalibrated grading (2025 model)
    let grade;
    if (entityScore >= 95) grade = "A+ (Elite AI-Trust)";
    else if (entityScore >= 85) grade = "A (Strong Authority)";
    else if (entityScore >= 75) grade = "B (Moderate AI Visibility)";
    else if (entityScore >= 60) grade = "C (Needs Optimization)";
    else if (entityScore >= 40) grade = "D (Weak Signals)";
    else grade = "F (Non-Entity)";

    // Response object
    const auditResult = {
      url: targetUrl,
      title: getMeta("og:title") || getMeta("twitter:title") || html.match(/<title>(.*?)<\/title>/i)?.[1] || null,
      canonical: html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || null,
      description: getMeta("description") || getMeta("og:description") || null,
      schemaCount,
      entityScore,
      grade,
      checks: {
        hasJSONLD,
        hasCanonical,
        hasMetaDesc,
        hasTitle
      },
      timestamp: new Date().toISOString()
    };

    return res.status(200).json(auditResult);

  } catch (error) {
    // Handle non-JSON or 404 gracefully
    return res.status(500).json({
      error: "Server returned non-JSON response",
      response: error.message || String(error)
    });
  }
}
