import axios from "axios";
import cheerio from "cheerio";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export default async function handler(req, res) {
  try {
    const url = (req.method === "GET" ? req.query.url : req.body?.url)?.trim();
    const email = (req.method === "GET" ? req.query.email : req.body?.email)?.trim();
    const tier = (req.method === "GET" ? req.query.tier : req.body?.tier)?.trim();

    if (!url) return res.status(400).json({ error: "Missing url" });

    const { data, headers } = await axios.get(url, { timeout: 10000, maxRedirects: 5 });
    const $ = cheerio.load(data);

    const ldCount = $('script[type="application/ld+json"]').length;
    const canonical = $('link[rel="canonical"]').attr('href') || null;
    const metaDesc = $('meta[name="description"]').attr('content') || null;
    const title = $('title').text().trim() || null;

    let score = 0;
    if (ldCount > 0) score += 40;
    if (canonical) score += 30;
    if (metaDesc) score += 20;
    if (title) score += 10;

    const issues = [];
    if (ldCount === 0) issues.push("No JSON-LD schema found");
    if (!canonical) issues.push("Missing canonical link");
    if (!metaDesc) issues.push("No meta description");

    const report = {
      auditedAt: new Date().toISOString(),
      target: url,
      httpContentType: headers["content-type"] || null,
      pageTitle: title,
      entityScore: score,
      checks: { ldJsonCount: ldCount, canonical, metaDescPresent: !!metaDesc },
      issues,
      recommendations: [
        ldCount === 0 ? "Add Organization/Person/Product JSON-LD as appropriate." : null,
        !canonical ? "Add <link rel=\"canonical\" href=\"...\"> pointing to your primary URL." : null,
        !metaDesc ? "Add a concise meta description (120–160 chars)." : null
      ].filter(Boolean)
    };

    if (resend && email) {
      const html = `
        <h3>exmxc.ai — Entity Audit</h3>
        <p><b>URL:</b> ${url}</p>
        <p><b>Score:</b> ${score}/100</p>
        <p><b>Issues:</b> ${issues.length ? issues.join(", ") : "None"}</p>
        <pre style="white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px;">${JSON.stringify(report, null, 2)}</pre>
      `;
      try {
        await resend.emails.send({
          from: "Ella <ella@exmxc.ai>",
          to: email,
          subject: "Your Entity Audit Report",
          html
        });
      } catch {}
    }

    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Audit failed" });
  }
}
