import axios from "axios";
import * as cheerio from "cheerio";

/**
 * ============================================================
 * exmxc.ai | Entity Engineering Index (EEI) Audit API v2
 * ------------------------------------------------------------
 * ✅ Keeps full EEI scoring logic
 * ✅ Adds verified CORS whitelist for Webflow + exmxc
 * ============================================================
 */

const UA = "Mozilla/5.0 (compatible; exmxc-audit/1.0; +https://exmxc.ai)";

/* ---------- Helper Utils ---------- */
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

function tryParseJSON(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function daysSince(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
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

/* ---------- Metric Scorers ---------- */
function scoreSchema(schemaObjects) {
  const valid = schemaObjects.length;
  const ratio = Math.min(valid, 5) / 5;
  return { points: Math.round(ratio * 25), raw: { validSchemaBlocks: valid } };
}

function scoreAlignment(title, description) {
  const sim = jaccard(title, description);
  return { points: Math.round(sim * 20), raw: { similarity: Number(sim.toFixed(3)) } };
}

function scoreLinks(allLinks, originHost) {
  const total = allLinks.length;
  let internal = 0;
  for (const href of allLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      if (u.hostname.replace(/^www\./i, "") === originHost) internal++;
    } catch {}
  }
  const ratio = total ? internal / total : 0;
  return {
    points: Math.round(Math.min(ratio, 1) * 15),
    raw: { total, internal, ratio: Number(ratio.toFixed(3)) },
  };
}

function scoreCanonical(canonicalHref) {
  try {
    const u = new URL(canonicalHref);
    return { points: u.hostname ? 10 : 0, raw: { canonicalPresentAndAbsolute: !!u.hostname } };
  } catch {
    return { points: 0, raw: { canonicalPresentAndAbsolute: false } };
  }
}

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

  return { points, raw: { entityName, nameInTitle, nameInSchema, domainInTitle } };
}

function scoreDiversity(distinctTypes) {
  const ratio = Math.min(distinctTypes.size, 5) / 5;
  return { points: Math.round(ratio * 10), raw: { distinctTypes: [...distinctTypes] } };
}

function scoreCrossRefs({ sameAs = [], pageLinks = [] }) {
  const socialHosts = [
    "linkedin.com", "instagram.com", "youtube.com", "x.com", "twitter.com",
    "facebook.com", "wikipedia.org", "threads.net", "tiktok.com", "github.com"
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
  return { points: count, raw: { distinctVerifiedHosts: [...seen] } };
}

function scoreFreshness(latestDateStr) {
  if (!latestDateStr) return { points: 0, raw: { latestISO: null, days: null } };
  const d = daysSince(latestDateStr);
  let points = 0;
  if (d <= 90) points = 5;
  else if (d <= 180) points = 3;
  return { points, raw: { latestISO: new Date(latestDateStr).toISOString(), days: d } };
}

/* ---------- Main Handler ---------- */
export default async function handler(req, res) {
  // ✅ CORS v3 — Universal Allowlist + Preflight Passthrough
  const allowedOrigins = [
    "https://exmxc.ai",
    "https://www.exmxc.ai",
    "https://preview.webflow.com",
    "https://exmxc-audit.vercel.app",
  ];

  const origin = req.headers.origin || "";
  const allowed = allowedOrigins.find(o => origin.startsWith(o));

  res.setHeader("Access-Control-Allow-Origin", allowed || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // ✅ Preflight shortcut
  }

  res.setHeader("Content-Type", "application/json");

    const normalized = normalizeUrl(input);
    if (!normalized) return res.status(400).json({ error: "Invalid URL format" });

    const originHost = hostnameOf(normalized);

    let html;
    try {
      const resp = await axios.get(normalized, {
        timeout: 15000,
        maxRedirects: 5,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      html = resp.data;
    } catch (e) {
      return res.status(500).json({ error: "Failed to fetch URL", details: e.message });
    }

    const $ = cheerio.load(html);
    const title = $("title").first().text().trim() || "";
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const canonical =
      $('link[rel="canonical"]').attr("href") || normalized.replace(/\/$/, "");

    const pageLinks = $("a[href]").map((_, el) => $(el).attr("href")).get().filter(Boolean);
    const ldBlocks = $("script[type='application/ld+json']").map((_, el) => $(el).contents().text()).get();
    const schemaObjects = ldBlocks.flatMap(tryParseJSON);

    const distinctTypes = new Set();
    const schemaNames = [];
    const sameAs = [];
    let latestISO = null;

    for (const obj of schemaObjects) {
      const t = obj["@type"];
      if (typeof t === "string") distinctTypes.add(t);
      else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && distinctTypes.add(x));
      if (typeof obj.name === "string") schemaNames.push(obj.name);
      if (obj.sameAs) {
        if (Array.isArray(obj.sameAs)) sameAs.push(...obj.sameAs);
        else if (typeof obj.sameAs === "string") sameAs.push(obj.sameAs);
      }
      const dateCandidates = [
        obj.dateModified, obj.dateUpdated, obj.datePublished, obj.uploadDate,
      ].filter(Boolean);
      for (const dc of dateCandidates) {
        const d = new Date(dc);
        if (!Number.isNaN(d.getTime())) {
          if (!latestISO || d > new Date(latestISO)) latestISO = d.toISOString();
        }
      }
    }

    // ---- Scoring
    const mSchema = scoreSchema(schemaObjects);
    const mAlign = scoreAlignment(title, description);
    const mLinks = scoreLinks(pageLinks, originHost);
    const mCanon = scoreCanonical(canonical);
    const mName = scoreNamePrecision({ entityName: schemaNames[0], title, schemaNames, domain: originHost });
    const mDiver = scoreDiversity(distinctTypes);
    const mXref = scoreCrossRefs({ sameAs, pageLinks });
    const mFresh = scoreFreshness(latestISO);

    const entityScore = Math.min(
      100,
      mSchema.points + mAlign.points + mLinks.points + mCanon.points +
      mName.points + mDiver.points + mXref.points + mFresh.points
    );

    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: originHost,
      title,
      description,
      canonical,
      schemaBlocks: schemaObjects.length,
      entityScore,
      metrics: { mSchema, mAlign, mLinks, mCanon, mName, mDiver, mXref, mFresh },
    });

  } catch (err) {
    console.error("Audit error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
