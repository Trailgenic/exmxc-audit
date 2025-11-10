// /api/predictive-audit.js — Stage 1 (Batch Crawl from core-web.json)

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

/* ================================
   CONFIG
   ================================ */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-predictive/1.0 Safari/537.36";

// ✅ Load core-web.json once at startup (static)
const DATA_PATH = path.join(process.cwd(), "data", "core-web.json");
let CORE_SITES = [];
try {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  CORE_SITES = JSON.parse(raw);
  console.log(`Loaded ${CORE_SITES.length} core sites from core-web.json`);
} catch (err) {
  console.error("❌ Failed to load core-web.json:", err.message);
  CORE_SITES = [];
}

/* ================================
   HELPERS
   ================================ */

function normalizeUrl(input) {
  let url = (input || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (!u.pathname) u.pathname = "/";
    return u.toString();
  } catch {
    return null;
  }
}

/* ================================
   CORE CRAWL
   ================================ */

async function fetchCoreSignals(url) {
  try {
    const resp = await axios.get(url, {
      timeout: 12000,
      maxRedirects: 5,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      validateStatus: (s) => s >= 200 && s < 400,
      // ⚙️ proxy slot (inactive for Stage 1)
      // proxy: { host: "proxyhost", port: 8080, auth: { username: "user", password: "pass" } },
    });

    const html = resp.data || "";
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const canonical =
      $('link[rel="canonical"]').attr("href") ||
      url.replace(/\/$/, "");
    const hasSchema = $("script[type='application/ld+json']").length > 0;
    const hasBreadcrumb = html.includes('"BreadcrumbList"');
    const hasOrg = html.includes('"Organization"');
    const hasPerson = html.includes('"Person"');

    const score =
      (title ? 10 : 0) +
      (description ? 10 : 0) +
      (canonical ? 10 : 0) +
      (hasSchema ? 20 : 0) +
      (hasOrg ? 10 : 0) +
      (hasBreadcrumb ? 10 : 0) +
      (hasPerson ? 10 : 0);

    return {
      url,
      title,
      description,
      canonical,
      score: Math.min(score, 100),
      schemaSignals: { hasSchema, hasOrg, hasBreadcrumb, hasPerson },
      status: resp.status,
    };
  } catch (err) {
    return {
      url,
      error: err.message,
      status: err.response?.status || "FETCH_FAIL",
    };
  }
}

/* ================================
   MAIN HANDLER
   ================================ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (!CORE_SITES.length) {
      return res.status(500).json({ error: "core-web.json not loaded" });
    }

    const results = [];
    for (const site of CORE_SITES) {
      const normalized = normalizeUrl(site.url || site);
      if (!normalized) continue;
      const data = await fetchCoreSignals(normalized);
      results.push(data);
    }

    // Save results file locally (non-persistent, but good for debug)
    const OUTPUT_PATH = path.join("/tmp", "core-web-results.json");
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

    return res.status(200).json({
      success: true,
      totalSites: CORE_SITES.length,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (err) {
    console.error("Predictive Audit Error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
