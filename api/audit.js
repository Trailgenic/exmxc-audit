import axios from "axios";
import * as cheerio from "cheerio";
import { Resend } from "resend";

export default async function handler(req, res) {
  try {
    const url =
      req.method === "POST"
        ? req.body?.url
        : req.query?.url;

    if (!url) {
      return res.status(400).json({ error: "Missing URL" });
    }

    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);

    const title = $("title").text() || "No title found";
    const schemaCount = $("script[type='application/ld+json']").length;
    const canonical = $("link[rel='canonical']").attr("href") || "Not found";
    const description = $("meta[name='description']").attr("content") || "Not found";
    const entityScore = Math.min(100, schemaCount * 20);

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "audit@exmxc.ai",
        to: "you@example.com",
        subject: `Audit Report for ${url}`,
        html: `<h2>${url}</h2>
               <p><b>Title:</b> ${title}</p>
               <p><b>Schema Count:</b> ${schemaCount}</p>
               <p><b>Canonical:</b> ${canonical}</p>
               <p><b>Description:</b> ${description}</p>
               <p><b>Entity Score:</b> ${entityScore}</p>`
      });
    }

    return res.status(200).json({
      url,
      title,
      canonical,
      description,
      schemaCount,
      entityScore,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Audit error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
