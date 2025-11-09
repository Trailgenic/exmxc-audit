// api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

/* =========================
   C O N F I G
========================= */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) exmxc-audit-bot/1.1 (+https://exmxc.ai)";

// Normalized 100-point rubric weights
// (kept explicit so it’s easy to tune later)
const WEIGHTS = {
  title: 8,
  description: 8,
  canonical: 8,

  // Schema group
  schemaPresence: 20,
  orgSchema: 8,
  breadcrumbSchema: 8,
  personSchema: 8,

  // Other signals
  socialLinks: 4,
  aiCrawlTrust: 4,
  contentDepth: 8,
  internalLinks: 8,
  externalLinks: 4,
  branding: 4,
};

// Tiers on 0–100
function entityTier(score) {
  if (score >= 90) return "Platinum Entity";
  if (score >= 70) return "Gold Entity";
  if (score >= 50) return "Silver Entity";
  if (score >= 30) return "Bronze Entity";
  return "Obscure Entity";
}

// Helpers
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
function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function safeISO(d) {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/* =========================
   S C O R E R S
========================= */

function scoreTitle($) {
  const t = $("title").first().text().trim();
  const good = t && t.length >= 10 && t.length <= 70; // simple heuristic
  const specific =
    /[\-|\u2013|:]/.test(t) || /\b(about|official|method|guide|home|store)\b/i.test(t);
  let pts = 0;
  if (t) pts = 4;
  if (t && good && specific) pts = 8;
  return { points: pts, raw: { title: t } };
}

function scoreMetaDescription($) {
  const d =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  let pts = 0;
  if (d) pts = 4;
  if (d && d.length >= 80 && d.length <= 200) pts = 8;
  return { points: pts, raw: { description: d } };
}

function scoreCanonical($, normalized) {
  const href = $('link[rel="canonical"]').attr("href") || "";
  let valid = false;
  try {
    const u = new URL(href || normalized);
    valid = Boolean(u.protocol && u.hostname);
  } catch {
    valid = false;
  }
  // Clean + matches page (allow trailing slash variance)
  const match =
    href &&
    new URL(href).origin === new URL(normalized).origin &&
    new URL(href).pathname.replace(/\/$/, "") ===
      new URL(normalized).pathname.replace(/\/$/, "");
  const pts = !href ? 0 : match ? 8 : 5;
  return { points: pts, raw: { canonical: href || null, matches: match, valid } };
}

function parseLD($) {
  const blocks = $("script[type='application/ld+json']")
    .map((_, el) => $(el).contents().text())
    .get();

  const objs = [];
  for (const txt of blocks) {
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) objs.push(...parsed);
      else objs.push(parsed);
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return objs;
}

function scoreSchemaPresence(schemaObjects) {
  const count = schemaObjects.length;
  // 0 = none, 10 = one, 20 = two or more
  const pts = count === 0 ? 0 : count === 1 ? 10 : 20;
  return { points: pts, raw: { blocks: count } };
}

function hasType(obj, type) {
  const t = obj["@type"];
  if (typeof t === "string") return t.toLowerCase() === type.toLowerCase();
  if (Array.isArray(t))
    return t.map((x) => String(x).toLowerCase()).includes(type.toLowerCase());
  return false;
}

function scoreOrgSchema(schemaObjects) {
  const present = schemaObjects.some((o) => hasType(o, "Organization"));
  return { points: present ? 8 : 0, raw: { present } };
}
function scoreBreadcrumb(schemaObjects) {
  const present = schemaObjects.some((o) => hasType(o, "BreadcrumbList"));
  return { points: present ? 8 : 0, raw: { present } };
}
function scorePerson(schemaObjects) {
  const personish = schemaObjects.some((o) => hasType(o, "Person") || o.author);
  return { points: personish ? 8 : 0, raw: { present: personish } };
}

function scoreSocialLinks(schemaObjects, $, originHost) {
  const socialHosts = [
    "linkedin.com",
    "instagram.com",
    "youtube.com",
    "x.com",
    "twitter.com",
    "facebook.com",
    "threads.net",
    "tiktok.com",
    "github.com",
  ];
  const seen = new Set();

  const check = (u) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./i, "");
      if (socialHosts.some((s) => h.endsWith(s))) seen.add(h);
    } catch {}
  };

  // sameAs from JSON-LD
  for (const o of schemaObjects) {
    if (o.sameAs) {
      if (Array.isArray(o.sameAs)) o.sameAs.forEach(check);
      else if (typeof o.sameAs === "string") check(o.sameAs);
    }
  }
  // anchors on page
  $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .forEach(check);

  // 0 none, 3 partial, 5 full-ish
  const count = seen.size;
  const pts = count >= 3 ? 5 : count > 0 ? 3 : 0;
  return { points: pts, raw: { hosts: Array.from(seen) } };
}

function scoreAICrawlTrust($, html) {
  // Basic signals:
  // - Not blocked by robots meta
  // - Explicit crawl ping or beacon present (heuristic: "ai-crawl-ping" in markup)
  const robots = $('meta[name="robots"]').attr("content") || "";
  const notBlocked = !/noindex|nofollow/i.test(robots);
  const hasPing =
    /ai[-_]crawl[-_]ping/i.test(html) ||
    /pixel/i.test(html) && /crawl/i.test(html);

  let pts = 0;
  if (notBlocked) pts = 3;
  if (notBlocked && hasPing) pts = 5;
  return { points: pts, raw: { robots, notBlocked, hasPing } };
}

function scoreContentDepth($) {
  // Rough word count of visible text (remove scripts/styles)
  const cloned = $.root().clone();
  cloned.find("script,style,noscript").remove();
  const text = cloned.text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;

  // 0 < 300, 5 moderate, 8 deep
  let pts = 0;
  if (words >= 300) pts = 5;
  if (words >= 1000) pts = 8;

  return { points: pts, raw: { words } };
}

function scoreInternalLinks($, originHost) {
  const hrefs = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  let internal = 0;
  for (const href of hrefs) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host === originHost) internal++;
    } catch {}
  }

  const total = hrefs.length;
  const ratio = total ? internal / total : 0;

  // scale: 0 none, 4 few, 8 strong network
  let pts = 0;
  if (internal > 0) pts = 4;
  if (ratio >= 0.5 && internal >= 10) pts = 8;

  return {
    points: pts,
    raw: { totalLinks: total, internalLinks: internal, internalRatio: Number(ratio.toFixed(3)) },
  };
}

function scoreExternalLinks($, originHost) {
  const hrefs = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  let external = 0;
  for (const href of hrefs) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host !== originHost && /^https?:/i.test(u.protocol)) external++;
    } catch {}
  }

  // 0 none, 2 few, 4 several reputable sources (we don't validate domains yet)
  const pts = external >= 3 ? 4 : external > 0 ? 2 : 0;
  return { points: pts, raw: { externalLinks: external } };
}

function scoreBranding($) {
  const hasFavicon =
    $('link[rel="icon"]').length ||
    $('link[rel="shortcut icon"]').length ||
    $('link[rel="apple-touch-icon"]').length;

  const hasOGImage = $('meta[property="og:image"]').attr("content") ? 1 : 0;
  const pts = hasFavicon && hasOGImage ? 4 : hasFavicon || hasOGImage ? 2 : 0;

  return { points: pts, raw: { hasFavicon: !!hasFavicon, hasOGImage: !!hasOGImage } };
}

/* =========================
   H T T P  H A N D L E R
========================= */

export default async function handler(req, res) {
  // CORS — echo origin if present, otherwise allow exmxc.ai
  const origin = req.headers.origin || "";
  const allowOrigin =
    ["https://exmxc.ai", "https://www.exmxc.ai", "https://preview.webflow.com"].includes(origin)
      ? origin
      : "https://exmxc.ai";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

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
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
        },
        // Accept 2xx–3xx
        validateStatus: (s) => s >= 200 && s < 400,
      });
      html = resp.data;
    } catch (e) {
      return res.status(500).json({
        error: "Failed to fetch URL",
        details: e?.message || "Request blocked or timed out",
        url: normalized,
      });
    }

    const $ = cheerio.load(html);
    const schemaObjects = parseLD($);

    // Compute each metric (0..weight)
    const mTitle = scoreTitle($);
    mTitle.points = clamp(mTitle.points, 0, WEIGHTS.title);

    const mDesc = scoreMetaDescription($);
    mDesc.points = clamp(mDesc.points, 0, WEIGHTS.description);

    const mCanon = scoreCanonical($, normalized);
    mCanon.points = clamp(mCanon.points, 0, WEIGHTS.canonical);

    const mSchemaPresence = scoreSchemaPresence(schemaObjects);
    mSchemaPresence.points = clamp(mSchemaPresence.points, 0, WEIGHTS.schemaPresence);

    const mOrg = scoreOrgSchema(schemaObjects);
    mOrg.points = clamp(mOrg.points, 0, WEIGHTS.orgSchema);

    const mBreadcrumb = scoreBreadcrumb(schemaObjects);
    mBreadcrumb.points = clamp(mBreadcrumb.points, 0, WEIGHTS.breadcrumbSchema);

    const mPerson = scorePerson(schemaObjects);
    mPerson.points = clamp(mPerson.points, 0, WEIGHTS.personSchema);

    const mSocial = scoreSocialLinks(schemaObjects, $, originHost);
    mSocial.points = clamp(mSocial.points, 0, WEIGHTS.socialLinks);

    const mCrawl = scoreAICrawlTrust($, html);
    mCrawl.points = clamp(mCrawl.points, 0, WEIGHTS.aiCrawlTrust);

    const mDepth = scoreContentDepth($);
    mDepth.points = clamp(mDepth.points, 0, WEIGHTS.contentDepth);

    const mInternal = scoreInternalLinks($, originHost);
    mInternal.points = clamp(mInternal.points, 0, WEIGHTS.internalLinks);

    const mExternal = scoreExternalLinks($, originHost);
    mExternal.points = clamp(mExternal.points, 0, WEIGHTS.externalLinks);

    const mBrand = scoreBranding($);
    mBrand.points = clamp(mBrand.points, 0, WEIGHTS.branding);

    // Final score (0–100)
    const entityScore =
      mTitle.points +
      mDesc.points +
      mCanon.points +
      mSchemaPresence.points +
      mOrg.points +
      mBreadcrumb.points +
      mPerson.points +
      mSocial.points +
      mCrawl.points +
      mDepth.points +
      mInternal.points +
      mExternal.points +
      mBrand.points;

    // Signal breakdown for UI bars
    const signals = [
      { key: "title", label: "Title", weight: WEIGHTS.title, ...mTitle },
      { key: "description", label: "Meta Description", weight: WEIGHTS.description, ...mDesc },
      { key: "canonical", label: "Canonical URL", weight: WEIGHTS.canonical, ...mCanon },

      { key: "schemaPresence", label: "Schema", weight: WEIGHTS.schemaPresence, ...mSchemaPresence },
      { key: "orgSchema", label: "Organization Schema", weight: WEIGHTS.orgSchema, ...mOrg },
      { key: "breadcrumbSchema", label: "Breadcrumb Schema", weight: WEIGHTS.breadcrumbSchema, ...mBreadcrumb },
      { key: "personSchema", label: "Author/Person Schema", weight: WEIGHTS.personSchema, ...mPerson },

      { key: "socialLinks", label: "Social Entity Links", weight: WEIGHTS.socialLinks, ...mSocial },
      { key: "aiCrawlTrust", label: "AI Crawl Trust", weight: WEIGHTS.aiCrawlTrust, ...mCrawl },
      { key: "contentDepth", label: "Content Depth", weight: WEIGHTS.contentDepth, ...mDepth },
      { key: "internalLinks", label: "Internal Link Density", weight: WEIGHTS.internalLinks, ...mInternal },
      { key: "externalLinks", label: "External Outbound Links", weight: WEIGHTS.externalLinks, ...mExternal },
      { key: "branding", label: "Favicon & OG Branding", weight: WEIGHTS.branding, ...mBrand },
    ].map((s) => ({
      ...s,
      // expose 0..weight and a normalized 0..1 "strength"
      strength: s.weight ? Number((s.points / s.weight).toFixed(3)) : 0,
    }));

    // High-level fields the frontend already expects
    const title = $("title").first().text().trim() || "";
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: originHost,
      title,
      description,
      entityScore: Math.round(entityScore),
      entityTier: entityTier(entityScore),
      metrics: {
        // keep compatibility with v1 objects where useful
        title: mTitle,
        description: mDesc,
        canonical: mCanon,
        schemaPresence: mSchemaPresence,
        orgSchema: mOrg,
        breadcrumbSchema: mBreadcrumb,
        personSchema: mPerson,
        socialLinks: mSocial,
        aiCrawlTrust: mCrawl,
        contentDepth: mDepth,
        internalLinks: mInternal,
        externalLinks: mExternal,
        branding: mBrand,
      },
      signals, // full breakdown for the UI
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
