// exmxc.ai — Recursive Entity Audit (same-domain crawler)
// Runtime: Node 20 (uses native fetch) + Cheerio
import * as cheerio from "cheerio";

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    // strip hash, keep query for uniqueness (you can drop queries if desired)
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function sameDomain(urlA, urlB) {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.hostname === b.hostname;
  } catch {
    return false;
  }
}

function extractSchemas($) {
  const types = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = $(el).text();
      const data = JSON.parse(json);
      const collect = (node) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(collect);
        const t = node["@type"];
        if (typeof t === "string") types.push(t);
        else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.push(x));
        // dive into graph if present
        if (node["@graph"]) collect(node["@graph"]);
      };
      collect(data);
    } catch {}
  });
  // dedupe
  return [...new Set(types)];
}

function scorePage({ hasSchema, hasCanonical, hasMetaDesc, hasTitle }) {
  // Simple v1 weights; we’ll refine later
  let score = 0;
  if (hasSchema) score += 40;
  if (hasCanonical) score += 25;
  if (hasMetaDesc) score += 20;
  if (hasTitle) score += 15;
  return score;
}

// Per-page audit
async function auditPage(targetUrl, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  let html = "";
  let status = 0;
  try {
    const resp = await fetch(targetUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Polite UA helps some hosts allow fetches
        "User-Agent":
          "exmxc-audit/1.0 (+https://www.exmxc.ai) Node/20 Vercel-Function",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    status = resp.status;
    html = await resp.text();
  } finally {
    clearTimeout(t);
  }

  const loadMs = Date.now() - startedAt;

  const $ = cheerio.load(html || "");
  const title = $("title").first().text().trim() || null;
  const metaDesc = $('meta[name="description"]').attr("content") || null;
  const canonical = $('link[rel="canonical"]').attr("href") || null;

  const schemaTypes = extractSchemas($);
  const hasSchema = schemaTypes.length > 0;
  const hasTitle = !!title;
  const hasMetaDesc = !!metaDesc;
  const hasCanonical = !!canonical;

  const issues = [];
  if (!hasSchema) issues.push("No JSON-LD schema found");
  if (!hasCanonical) issues.push("Missing canonical link");
  if (!hasMetaDesc) issues.push("Missing meta description");
  if (!hasTitle) issues.push("Missing <title>");

  const score = scorePage({ hasSchema, hasCanonical, hasMetaDesc, hasTitle });

  return {
    url: targetUrl,
    status,
    loadMs,
    title,
    metaDesc,
    canonical,
    schemaTypes,
    hasSchema,
    hasCanonical,
    hasMetaDesc,
    hasTitle,
    score,
    issues,
  };
}

// ---------- Main handler ----------
export default async function handler(req, res) {
  try {
    const isGet = req.method === "GET";
    const url = (isGet ? req.query.url : req.body?.url)?.toString().trim();
    if (!url) return res.status(400).json({ error: "Missing url" });

    const crawl = ((isGet ? req.query.crawl : req.body?.crawl) ?? "false").toString() === "true";
    const depthMax = Math.max(
      0,
      Math.min(3, parseInt((isGet ? req.query.depth : req.body?.depth) ?? "2", 10) || 2)
    );
    const pageLimit = Math.max(
      1,
      Math.min(200, parseInt((isGet ? req.query.limit : req.body?.limit) ?? "25", 10) || 25)
    );
    const perRequestTimeout = 10000; // 10s per request budget
    const politeDelayMs = 100; // tiny delay to be nice to hosts

    const origin = new URL(url).origin;

    // Always audit the root URL first
    const results = [];
    const visited = new Set();
    const queue = [{ href: url, depth: 0 }];

    while (queue.length && results.length < pageLimit) {
      const { href, depth } = queue.shift();

      if (visited.has(href)) continue;
      visited.add(href);

      // Audit this page
      let pageResult;
      try {
        pageResult = await auditPage(href, perRequestTimeout);
      } catch (err) {
        pageResult = {
          url: href,
          status: 0,
          loadMs: 0,
          title: null,
          metaDesc: null,
          canonical: null,
          schemaTypes: [],
          hasSchema: false,
          hasCanonical: false,
          hasMetaDesc: false,
          hasTitle: false,
          score: 0,
          issues: [`Fetch/audit error: ${err?.message || "unknown"}`],
        };
      }
      results.push(pageResult);

      // Stop expanding if we’re not crawling or depth cap reached
      if (!crawl || depth >= depthMax) {
        if (results.length >= pageLimit) break;
        continue;
      }

      // Extract same-domain links and enqueue
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), perRequestTimeout);
        const resp = await fetch(href, { signal: controller.signal });
        const html = await resp.text();
        clearTimeout(t);

        const $ = cheerio.load(html);
        const found = new Set();

        $("a[href]").each((_, el) => {
          const raw = $(el).attr("href");
          const abs = normalizeUrl(raw, href);
          if (!abs) return;
          if (!sameDomain(abs, origin)) return;         // same-domain only
          if (!abs.startsWith(origin)) return;          // lock to origin
          found.add(abs);
        });

        for (const link of found) {
          if (results.length + queue.length >= pageLimit) break;
          if (!visited.has(link)) queue.push({ href: link, depth: depth + 1 });
        }
      } catch {
        // ignore link expansion errors; we already have the page audit
      }

      if (results.length < pageLimit) await sleep(politeDelayMs);
    }

    // Compute summary stats
    const avgScore =
      results.length ? Math.round((results.reduce((s, r) => s + (r.score || 0), 0) / results.length) * 10) / 10 : 0;
    const withSchema = results.filter((r) => r.hasSchema).length;

    const payload = {
      target: url,
      crawl,
      depth: depthMax,
      pageLimit,
      auditedPages: results.length,
      averageScore: avgScore,
      pagesWithSchema: withSchema,
      timestamp: new Date().toISOString(),
      pages: results,
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Crawler error:", err);
    return res.status(500).json({ error: err.message || "Crawl failed" });
  }
}
