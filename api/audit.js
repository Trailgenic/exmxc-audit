// /api/audit.js  — Phase 2B (Rubric-based signals, 0–100)

import axios from "axios";
import * as cheerio from "cheerio";

/* ================================
   CONFIG
   ================================ */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/2.0 Safari/537.36";

// Rubric weights (sum = 100)
const WEIGHTS = {
  title: 10,
  metaDescription: 10,
  canonical: 10,
  schemaPresence: 20,
  orgSchema: 8,
  breadcrumbSchema: 8,
  authorPerson: 8,
  socialLinks: 6,
  aiCrawl: 4,
  contentDepth: 10,
  internalLinks: 10,
  externalLinks: 4,
  faviconOg: 2,
};

const SOCIAL_HOSTS = [
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

function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, "");
  } catch {
    return "";
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
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function tierFromScore(score) {
  if (score >= 90) return "Platinum Entity";
  if (score >= 70) return "Gold Entity";
  if (score >= 50) return "Silver Entity";
  if (score >= 30) return "Bronze Entity";
  return "Obscure Entity";
}

/* ================================
   SCORERS (each returns {points, max, notes, raw})
   ================================ */

function scoreTitle($) {
  const title = ($("title").first().text() || "").trim();
  let points = 0;
  let notes = "Missing";
  if (title) {
    // very naive “generic” check
    const isShort = title.length < 15;
    const hasSeparator = / \| | - /.test(title);
    if (isShort) {
      points = 5;
      notes = "Present but vague/short";
    } else if (hasSeparator || title.length >= 30) {
      points = 10;
      notes = "Specific & contextual";
    } else {
      points = 7;
      notes = "Decent clarity";
    }
  }
  return { key: "Title Presence & Clarity", points, max: WEIGHTS.title, notes, raw: { title } };
}

function scoreMetaDescription($) {
  const md =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  let points = 0;
  let notes = "Missing";
  if (md) {
    if (md.length < 80) {
      points = 5;
      notes = "Present but short/weak";
    } else {
      points = 10;
      notes = "Descriptive & specific";
    }
  }
  return {
    key: "Meta Description",
    points,
    max: WEIGHTS.metaDescription,
    notes,
    raw: { metaDescription: md },
  };
}

function scoreCanonical($, normalizedUrl) {
  const href = ($('link[rel="canonical"]').attr("href") || "").trim();
  let points = 0;
  let notes = "Missing";
  if (href) {
    try {
      const can = new URL(href, normalizedUrl);
      const abs = can.protocol && can.hostname;
      const clean =
        abs &&
        (can.origin === new URL(normalizedUrl).origin) &&
        !/[?#]/.test(can.href);
      points = clean ? 10 : 5;
      notes = clean ? "Clean absolute canonical" : "Present but not clean/absolute";
    } catch {
      points = 3;
      notes = "Present but invalid URL";
    }
  }
  return {
    key: "Canonical URL",
    points,
    max: WEIGHTS.canonical,
    notes,
    raw: { canonical: href || null },
  };
}

function scoreSchemaPresence(schemaObjects) {
  const count = schemaObjects.length;
  // 0 = none, 10 = 1 block, 20 = 2+ blocks (scaled to WEIGHTS.schemaPresence)
  const ratio = clamp(Math.min(count, 2) / 2, 0, 1);
  const points = Math.round(ratio * WEIGHTS.schemaPresence);
  const notes = count === 0 ? "No JSON-LD" : count === 1 ? "1 schema block" : "2+ schema blocks";
  return {
    key: "Schema Presence",
    points,
    max: WEIGHTS.schemaPresence,
    notes,
    raw: { schemaBlocks: count },
  };
}

function scoreOrgSchema(schemaObjects) {
  const org = schemaObjects.find((o) => {
    const t = o["@type"];
    return (
      t === "Organization" ||
      (Array.isArray(t) && t.includes("Organization"))
    );
  });
  let points = 0;
  let notes = "Missing";
  if (org) {
    const hasName = typeof org.name === "string" && org.name.trim();
    const hasUrl = typeof org.url === "string" && org.url.trim();
    if (hasName && hasUrl) {
      points = WEIGHTS.orgSchema;
      notes = "Present & valid";
    } else {
      points = Math.round(WEIGHTS.orgSchema * 0.5);
      notes = "Present but incomplete";
    }
  }
  return {
    key: "Organization Schema",
    points,
    max: WEIGHTS.orgSchema,
    notes,
    raw: org ? { name: org.name || null, url: org.url || null } : null,
  };
}

function scoreBreadcrumbSchema(schemaObjects) {
  const crumb = schemaObjects.find((o) => {
    const t = o["@type"];
    return t === "BreadcrumbList" || (Array.isArray(t) && t.includes("BreadcrumbList"));
  });
  const points = crumb ? WEIGHTS.breadcrumbSchema : 0;
  const notes = crumb ? "Present" : "Missing";
  return {
    key: "Breadcrumb Schema",
    points,
    max: WEIGHTS.breadcrumbSchema,
    notes,
    raw: crumb || null,
  };
}

function scoreAuthorPerson(schemaObjects, $) {
  const person = schemaObjects.find((o) => {
    const t = o["@type"];
    return t === "Person" || (Array.isArray(t) && t.includes("Person"));
  });
  const metaAuthor =
    $('meta[name="author"]').attr("content") ||
    $('a[rel="author"]').text() ||
    "";
  let points = 0;
  let notes = "Missing";
  if (person) {
    points = WEIGHTS.authorPerson;
    notes = "Person schema present";
  } else if (metaAuthor) {
    points = Math.round(WEIGHTS.authorPerson * 0.5);
    notes = "Author meta present";
  }
  return {
    key: "Author/Person Schema",
    points,
    max: WEIGHTS.authorPerson,
    notes,
    raw: { person: !!person, metaAuthor: metaAuthor || null },
  };
}

function scoreSocialLinks(schemaObjects, pageLinks) {
  const seen = new Set();
  const add = (u) => {
    try {
      const host = new URL(u).hostname.replace(/^www\./i, "");
      if (SOCIAL_HOSTS.some((s) => host.endsWith(s))) seen.add(host);
    } catch {}
  };
  schemaObjects.forEach((o) => {
    const sa = o.sameAs;
    if (Array.isArray(sa)) sa.forEach(add);
    else if (typeof sa === "string") add(sa);
  });
  pageLinks.forEach(add);

  const count = seen.size;
  let points = 0;
  let notes = "None found";
  if (count >= 3) {
    points = WEIGHTS.socialLinks;
    notes = "Strong set (3+)";
  } else if (count >= 1) {
    points = Math.round(WEIGHTS.socialLinks * 0.5);
    notes = "Partial (1–2)";
  }
  return {
    key: "Social Entity Links",
    points,
    max: WEIGHTS.socialLinks,
    notes,
    raw: { distinctSocialHosts: Array.from(seen) },
  };
}

function scoreAICrawlSignals($) {
  // look for "ai-crawl-ping" pixel, robots meta allowing index
  const robots = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const allowIndex =
    robots === "" || /index/.test(robots); // treat empty as OK
  const aiPing = $('img[src*="ai-crawl-ping"], img[src*="crawl-ping"]').length > 0;

  let points = 0;
  let notes = "Blocked/unknown";
  if (!allowIndex) {
    points = 0;
    notes = "Robots meta blocks indexing";
  } else if (aiPing) {
    points = WEIGHTS.aiCrawl;
    notes = "Explicit crawl ping";
  } else {
    points = Math.round(WEIGHTS.aiCrawl * 0.6);
    notes = "Indexable, no explicit ping";
  }
  return {
    key: "AI Crawl Trust Signals",
    points,
    max: WEIGHTS.aiCrawl,
    notes,
    raw: { robots, aiPing },
  };
}

function scoreContentDepth($) {
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  let points = 0;
  let notes = "< 300 words";
  if (words >= 1200) {
    points = WEIGHTS.contentDepth;
    notes = "Deep context";
  } else if (words >= 300) {
    points = Math.round(WEIGHTS.contentDepth * 0.5);
    notes = "Moderate";
  }
  return {
    key: "Content Depth & Context",
    points,
    max: WEIGHTS.contentDepth,
    notes,
    raw: { wordCount: words },
  };
}

function scoreInternalLinks(pageLinks, originHost) {
  let total = 0;
  let internal = 0;
  for (const href of pageLinks) {
    total++;
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host === originHost) internal++;
    } catch {}
  }
  const ratio = total ? internal / total : 0;
  // 0 none, 5 few (~0.2), 10 strong (>=0.5)
  let points = 0;
  let notes = "No internal links";
  if (ratio >= 0.5 && internal >= 10) {
    points = WEIGHTS.internalLinks;
    notes = "Strong network";
  } else if (ratio >= 0.2 && internal >= 3) {
    points = Math.round(WEIGHTS.internalLinks * 0.5);
    notes = "Some internal linking";
  }
  return {
    key: "Internal Link / Graph Density",
    points,
    max: WEIGHTS.internalLinks,
    notes,
    raw: { totalLinks: total, internalLinks: internal, internalRatio: Number(ratio.toFixed(3)) },
  };
}

function scoreExternalLinks(pageLinks, originHost) {
  let externalHosts = new Set();
  for (const href of pageLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host !== originHost) externalHosts.add(host);
    } catch {}
  }
  const count = externalHosts.size;
  let points = 0;
  let notes = "No outbound links";
  if (count >= 1) {
    points = WEIGHTS.externalLinks;
    notes = "Outbound credibility present";
  }
  return {
    key: "External Outbound Links",
    points,
    max: WEIGHTS.externalLinks,
    notes,
    raw: { distinctOutboundHosts: Array.from(externalHosts).slice(0, 20), count },
  };
}

function scoreFaviconOg($) {
  const favicon =
    $('link[rel="icon"]').attr("href") ||
    $('link[rel="shortcut icon"]').attr("href") ||
    "";
  const ogImg = $('meta[property="og:image"]').attr("content") || "";
  let points = 0;
  let notes = "Missing";
  if (favicon || ogImg) {
    points = WEIGHTS.faviconOg;
    notes = "Branding present";
  }
  return {
    key: "Favicon & OG Branding",
    points,
    max: WEIGHTS.faviconOg,
    notes,
    raw: { favicon: favicon || null, ogImage: ogImg || null },
  };
}

/* ================================
   MAIN HANDLER
   ================================ */

export default async function handler(req, res) {
  // CORS (echo Origin when possible)
  const origin = req.headers.origin || req.headers.referer;
  let normalizedOrigin = "*";
  if (origin && origin !== "null") {
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      normalizedOrigin = "*";
    }
  }
  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (normalizedOrigin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.status(200).end();
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
    let html = "";
    try {
      const resp = await axios.get(normalized, {
        timeout: 15000,
        maxRedirects: 5,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      html = resp.data || "";
    } catch (e) {
      return res.status(500).json({
        error: "Failed to fetch URL",
        details: e?.message || "Request blocked or timed out",
        url: normalized,
      });
    }

    const $ = cheerio.load(html);

    // Collect basics
    const title = ($("title").first().text() || "").trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const canonicalHref =
      $('link[rel="canonical"]').attr("href") ||
      normalized.replace(/\/$/, "");

    const pageLinks = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean);

    const ldBlocks = $("script[type='application/ld+json']")
      .map((_, el) => $(el).contents().text())
      .get();

    const schemaObjects = ldBlocks.flatMap(tryParseJSON);

    // Freshness (best-effort)
    let latestISO = null;
    for (const obj of schemaObjects) {
      const ds = [obj.dateModified, obj.dateUpdated, obj.datePublished, obj.uploadDate].filter(Boolean);
      ds.forEach((dc) => {
        const d = new Date(dc);
        if (!Number.isNaN(d.getTime())) {
          if (!latestISO || d > new Date(latestISO)) latestISO = d.toISOString();
        }
      });
    }
    const metaDates = [
      $('meta[property="article:modified_time"]').attr("content"),
      $('meta[property="og:updated_time"]').attr("content"),
      $('meta[name="last-modified"]').attr("content"),
    ].filter(Boolean);
    metaDates.forEach((md) => {
      const d = new Date(md);
      if (!Number.isNaN(d.getTime())) {
        if (!latestISO || d > new Date(latestISO)) latestISO = d.toISOString();
      }
    });

    // Entity name (best-effort)
    let entityName =
      schemaObjects.find((o) => o["@type"] === "Organization" && typeof o.name === "string")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person" && typeof o.name === "string")?.name ||
      (title.includes(" | ") ? title.split(" | ")[0] : title.split(" - ")[0]);
    entityName = (entityName || "").trim();

    // Score each rubric category
    const breakdown = [];
    breakdown.push(scoreTitle($));
    breakdown.push(scoreMetaDescription($));
    breakdown.push(scoreCanonical($, normalized));
    breakdown.push(scoreSchemaPresence(schemaObjects));
    breakdown.push(scoreOrgSchema(schemaObjects));
    breakdown.push(scoreBreadcrumbSchema(schemaObjects));
    breakdown.push(scoreAuthorPerson(schemaObjects, $));
    breakdown.push(scoreSocialLinks(schemaObjects, pageLinks));
    breakdown.push(scoreAICrawlSignals($));
    breakdown.push(scoreContentDepth($));
    breakdown.push(scoreInternalLinks(pageLinks, originHost));
    breakdown.push(scoreExternalLinks(pageLinks, originHost));
    breakdown.push(scoreFaviconOg($));

    // Final score
    const entityScore = clamp(
      breakdown.reduce((sum, b) => sum + clamp(b.points, 0, b.max), 0),
      0,
      100
    );
    const entityTier = tierFromScore(entityScore);

    // Add strength 0..1 to each item
    breakdown.forEach((b) => {
      b.strength = b.max ? Number((clamp(b.points, 0, b.max) / b.max).toFixed(3)) : 0;
    });

  return res.status(200).json({
  success: true,
  url: normalized,
  hostname: originHost,
  entityName: entityName || null,
  title,
  canonical: canonicalHref,
  description,
  entityScore: Math.round(entityScore),
  entityTier,
  signals: breakdown, // 👈 renamed so frontend can render Signal Breakdown properly
  schemaMeta: {
    schemaBlocks: schemaObjects.length,
    latestISO,
  },
  timestamp: new Date().toISOString(),
});
} catch (err) {
  return res.status(500).json({
    error: "Internal server error",
    details: err?.message || String(err),
  });
}
