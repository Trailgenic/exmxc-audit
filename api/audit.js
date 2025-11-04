// api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

/**
 * ---------- Helper Utils ----------
 */
const UA =
  "Mozilla/5.0 (compatible; exmxc-audit/1.0; +https://exmxc.ai)";

function normalizeUrl(input) {
  let url = (input || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  // Force hostname-only inputs like "example.com" to resolve
  try {
    const u = new URL(url);
    // If no pathname provided, keep "/"
    if (!u.pathname) u.pathname = "/";
    return u.toString();
  } catch {
    return null;
  }
}

function tryParseJSON(text) {
  try {
    const parsed = JSON.parse(text);
    // Flatten arrays of JSON-LD blocks
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function daysSince(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return Infinity;
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function tokenSet(str) {
  return new Set(
    (str || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/**
 * ---------- Metric Scorers ----------
 * Each returns { points, raw } where points are already weighted.
 */

// 1) Schema Count + Validity (max 25)
function scoreSchema(schemaObjects) {
  const valid = schemaObjects.length;
  // Full credit at 5+ valid blocks, linear scale up to that
  const ratio = Math.min(valid, 5) / 5;
  const points = Math.round(ratio * 25);
  return { points, raw: { validSchemaBlocks: valid } };
}

// 2) Title–Description Alignment (max 20)
function scoreAlignment(title, description) {
  const sim = jaccard(title, description); // 0..1
  const points = Math.round(Math.min(sim, 1) * 20);
  return { points, raw: { similarity: Number(sim.toFixed(3)) } };
}

// 3) Internal Link Density (max 15)
function scoreLinks(allLinks, originHost) {
  const total = allLinks.length;
  let internal = 0;
  for (const href of allLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host === originHost) internal++;
    } catch {
      // ignore bad hrefs
    }
  }
  const ratio = total ? internal / total : 0;
  const points = Math.round(Math.min(ratio, 1) * 15);
  return {
    points,
    raw: { totalLinks: total, internalLinks: internal, internalRatio: Number(ratio.toFixed(3)) },
  };
}

// 4) Canonical Consistency (max 10)
function scoreCanonical(canonicalHref) {
  let ok = false;
  try {
    const u = new URL(canonicalHref);
    ok = Boolean(u.protocol && u.hostname);
  } catch {
    ok = false;
  }
  return { points: ok ? 10 : 0, raw: { canonicalPresentAndAbsolute: ok } };
}

// 5) Entity Name Precision (max 10)
function scoreNamePrecision({ entityName, title, schemaNames = [], domain }) {
  const t = (title || "").toLowerCase();
  const name = (entityName || "").toLowerCase();
  const nameInTitle = name && t.includes(name);
  const nameInSchema = schemaNames.some((n) => (n || "").toLowerCase().includes(name));
  const domainInTitle = domain && t.includes(domain);

  let points = 0;
  if (name && nameInTitle && nameInSchema) points = 10;
  else if (name && (nameInTitle || nameInSchema)) points = 6;
  else if (domainInTitle) points = 3;

  return {
    points,
    raw: { entityName, nameInTitle, nameInSchema, domainInTitle },
  };
}

// 6) Schema Diversity (max 10)
function scoreDiversity(distinctTypes) {
  // Full credit at 5+ different @type values
  const ratio = Math.min(distinctTypes.size, 5) / 5;
  const points = Math.round(ratio * 10);
  return { points, raw: { distinctTypes: Array.from(distinctTypes) } };
}

// 7) Cross-Referential Anchors (max 5)
function scoreCrossRefs({ sameAs = [], pageLinks = [] }) {
  const socialHosts = [
    "linkedin.com",
    "instagram.com",
    "youtube.com",
    "x.com",
    "twitter.com",
    "facebook.com",
    "wikipedia.org",
    "threads.net",
    "tiktok.com",
    "github.com",
  ];

  const seen = new Set();

  const checkUrl = (u) => {
    try {
      const host = new URL(u).hostname.replace(/^www\./i, "");
      if (socialHosts.some((s) => host.endsWith(s))) seen.add(host);
    } catch {}
  };

  sameAs.forEach(checkUrl);
  pageLinks.forEach(checkUrl);

  const count = Math.min(seen.size, 5);
  const points = count; // 1 point each, up to 5
  return { points, raw: { distinctVerifiedHosts: Array.from(seen) } };
}

// 8) Timestamp Freshness (max 5)
function scoreFreshness(latestDateStr) {
  if (!latestDateStr) return { points: 0, raw: { latestISO: null, days: null } };
  const d = daysSince(latestDateStr);
  let points = 0;
  if (d <= 90) points = 5;
  else if (d <= 180) points = 3;
  return { points, raw: { latestISO: new Date(latestDateStr).toISOString(), days: d } };
}

/**
 * ---------- Main Handler ----------
 */
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  try {
    const input = req.query?.url;
    if (!input || typeof input !== "string" || !input.trim()) {
      return res.status(400).json({ error: "Missing URL" });
    }

    const normalized = normalizeUrl(input);
    if (!normalized) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const originHost = hostnameOf(normalized);

    // Fetch HTML
    let html;
    try {
      const resp = await axios.get(normalized, {
        timeout: 15000,
        maxRedirects: 5,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        validateStatus: (s) => s >= 200 && s < 400, // allow 3xx we follow redirects anyway
      });
      html = resp.data;
    } catch (e) {
      return res.status(500).json({
        error: "Failed to fetch URL",
        details: e.message,
        url: normalized,
      });
    }

    const $ = cheerio.load(html);

    // ---- Core Meta
    const title = $("title").first().text().trim() || "";
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const canonical =
      $('link[rel="canonical"]').attr("href") || normalized.replace(/\/$/, "");

    // ---- All links on page (for internal density + cross refs)
    const pageLinks = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean);

    // ---- JSON-LD
    const ldBlocks = $("script[type='application/ld+json']")
      .map((_, el) => $(el).contents().text())
      .get();

    const schemaObjects = ldBlocks.flatMap(tryParseJSON);

    // Distinct @types
    const distinctTypes = new Set();
    const schemaNames = [];
    const sameAs = [];
    let latestISO = null;

    for (const obj of schemaObjects) {
      // types can be string or array
      const t = obj["@type"];
      if (typeof t === "string") distinctTypes.add(t);
      else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && distinctTypes.add(x));

      // names for name precision
      if (typeof obj.name === "string") schemaNames.push(obj.name);

      // sameAs links
      if (obj.sameAs) {
        if (Array.isArray(obj.sameAs)) sameAs.push(...obj.sameAs);
        else if (typeof obj.sameAs === "string") sameAs.push(obj.sameAs);
      }

      // freshness candidates
      const dateCandidates = [
        obj.dateModified,
        obj.dateUpdated,
        obj.datePublished,
        obj.uploadDate,
      ].filter(Boolean);

      for (const dc of dateCandidates) {
        const d = new Date(dc);
        if (!Number.isNaN(d.getTime())) {
          if (!latestISO || d > new Date(latestISO)) latestISO = d.toISOString();
        }
      }
    }

    // Extra freshness from meta tags
    const metaDates = [
      $('meta[property="article:modified_time"]').attr("content"),
      $('meta[property="og:updated_time"]').attr("content"),
      $('meta[name="last-modified"]').attr("content"),
    ].filter(Boolean);
    for (const md of metaDates) {
      const d = new Date(md);
      if (!Number.isNaN(d.getTime())) {
        if (!latestISO || d > new Date(latestISO)) latestISO = d.toISOString();
      }
    }

    // ---- Entity Name Guess
    // Prefer Organization/Person schema.name; else fallback to title left segment
    let entityName =
      schemaObjects.find((o) => o["@type"] === "Organization" && typeof o.name === "string")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person" && typeof o.name === "string")?.name ||
      (title.includes(" | ") ? title.split(" | ")[0] : title.split(" - ")[0]);

    entityName = (entityName || "").trim();

    /**
     * ---------- Score Each Metric ----------
     */
    const mSchema = scoreSchema(schemaObjects); // 25
    const mAlign = scoreAlignment(title, description); // 20
    const mLinks = scoreLinks(pageLinks, originHost); // 15
    const mCanon = scoreCanonical(canonical); // 10
    const mName = scoreNamePrecision({ entityName, title, schemaNames, domain: originHost }); // 10
    const mDiver = scoreDiversity(distinctTypes); // 10
    const mXref = scoreCrossRefs({ sameAs, pageLinks }); // 5
    const mFresh = scoreFreshness(latestISO); // 5

    const entityScore = Math.max(
      0,
      Math.min(
        100,
        mSchema.points +
          mAlign.points +
          mLinks.points +
          mCanon.points +
          mName.points +
          mDiver.points +
          mXref.points +
          mFresh.points
      )
    );

    /**
     * ---------- Recommendations ----------
     */
    const recommendations = [];
    if (mSchema.raw.validSchemaBlocks === 0)
      recommendations.push("Add JSON-LD (Organization, Article) with valid nesting.");
    if (mDiver.raw.distinctTypes.length < 2)
      recommendations.push("Increase schema diversity (e.g., BreadcrumbList, WebSite, Article).");
    if (!mCanon.raw.canonicalPresentAndAbsolute)
      recommendations.push("Add an absolute canonical <link> to reduce duplication risk.");
    if (mAlign.raw.similarity < 0.3)
      recommendations.push("Align <title> and meta description to the same core entity concept.");
    if (mLinks.raw.internalRatio < 0.35)
      recommendations.push("Strengthen internal linking to build a coherent entity graph.");
    if (mName.points < 6)
      recommendations.push("Ensure the entity name appears in both schema and <title>.");
    if (!mFresh.raw.latestISO || mFresh.raw.days > 180)
      recommendations.push("Refresh content or update schema timestamps to signal recency.");
    if (mXref.points < 3)
      recommendations.push("Add verified sameAs links to official social profiles in JSON-LD.");

    /**
     * ---------- Response ----------
     */
    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: originHost,
      entityName: entityName || null,
      title,
      canonical,
      description,
      // Primary score
      entityScore,
      // Detailed breakdown (already weighted points)
      metrics: {
        schema: mSchema,
        alignment: mAlign,
        links: mLinks,
        canonical: mCanon,
        namePrecision: mName,
        diversity: mDiver,
        crossRefs: mXref,
        freshness: mFresh,
      },
      // Raw signals (for debugging/insight)
      signals: {
        schemaBlocks: schemaObjects.length,
        distinctSchemaTypes: Array.from(distinctTypes),
        schemaNames,
        sameAs,
        latestISO: mFresh.raw.latestISO,
        internalLinkRatio: mLinks.raw.internalRatio,
      },
      recommendations,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Audit error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message || String(err),
    });
  }
}
