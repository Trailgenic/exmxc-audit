// ✅ exmxc | Audit Function (Node 20-compatible)

import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { Resend } from "resend";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    // Fetch target HTML
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract basic SEO / schema elements
    const title = $("title").text() || "N/A";
    const description = $('meta[name="description"]').attr("content") || "N/A";
    const canonical = $('link[rel="canonical"]').attr("href") || "N/A";
    const schemaCount = $('script[type="application/ld+json"]').length;

    // Email notification (optional, requires RESEND_API_KEY)
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      const resend = new Resend(resendApiKey);
      await resend.emails.send({
        from: "audit@exmxc.ai",
        to: "mike.ye@live.com",
        subject: `exmxc Audit Report: ${url}`,
        html: `
          <h2>✅ exmxc Audit Completed</h2>
          <p><strong>URL:</strong> ${url}</p>
          <p><strong>Title:</strong> ${title}</p>
          <p><strong>Description:</strong> ${description}</p>
          <p><strong>Canonical:</strong> ${canonical}</p>
          <p><strong>Schema Blocks:</strong> ${schemaCount}</p>
        `,
      });
    }

    // Return structured JSON response
    return res.status(200).json({
      status: "ok",
      site: url,
      title,
      description,
      canonical,
      schemaCount,
      auditedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Audit Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
