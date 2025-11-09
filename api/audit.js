// api/audit.js
import axios from "axios";
import * as cheerio from "cheerio";

/**
 * -----------------------------
 * Phase 2B: Rubric-based signals
 * -----------------------------
 * Scale: 0–100 (normalized)
 * Tiers:
 *   90–100 Platinum, 70–89 Gold, 50–69 Silver, 30–49 Bronze, 0–29 Obscure
 */

// ---- Constants / helpers
const UA = "Mozilla/5.0 (compatible; exmxc-audit/2.0; +https://exmxc.ai)";

// 100-point normalized weights
const WEIGHTS = {
  title: 8,
  meta: 8,
  canonical: 8,
  schemaPresence: 18,
  orgSchema: 9,
  breadcrumbSchema: 9,
  personSchema: 9,
  socialLinks: 4,
  aiCrawl: 4,
  contentDepth: 9,
  internalLinks: 9,
  externalLinks: 4,
  branding: 1, // favicon + OG image
};

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

function tokens(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
function jaccard(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function tierFor(score) {
  if (score >= 90) return "Platinum Entity";
  if (score >= 70) return "Gold Entity";
  if (score >= 50) return "Silver Entity";
  if (score >= 30) return "Bronze Entity";
  return "Obscure Entity";
}

// --------------------
// Signal score helpers
// --------------------
function scoreTitle($, weight) {
  const title = ($("title").first().text() || "").trim();
  if (!title) return { id: "title", label: "Title", weight, points: 0, rationale: "Missing <title>." };
  const len = title.length;
  // Clear + contextual heuristic: length + presence of brand/context words
  const contextual = /[\|\-–:]/.test(title) || len >= 20;
  const sim = jaccard(title, $('meta[name="description"]').attr("content") || "");
  let pct = 0;
  if (len > 0 && len <= 4) pct = 0.25;
  else if (len <= 15) pct = contextual ? 0.6 : 0.5;
  else if (len <= 65) pct = contextual ? 1 : 0.75;
  else pct = 0.6;
  // small bonus for alignment with meta
  pct = clamp(pct + Math.min(sim, 0.2), 0, 1);
  return {
    id: "title",
    label: "Title Presence & Clarity",
    weight,
    points: Math.round(weight * pct),
    rationale: title ? `Title OK (len=${len}, sim=${sim.toFixed(2)})` : "Missing title.",
  };
}

function scoreMetaDescription($, weight) {
  const desc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  if (!desc) return { id: "meta", label: "Meta Description", weight, points: 0, rationale: "Missing meta description." };
  const len = desc.trim().length;
  let pct = 0;
  if (len < 50) pct = 0.4;
  else if (len <= 170) pct = 1;
  else if (len <= 300) pct = 0.7;
  else pct = 0.5;
  return {
    id: "meta",
    label: "Meta Description",
    weight,
    points: Math.round(weight * pct),
    rationale: `Present (len=${len}).`,
  };
}

function scoreCanonical($, weight, originHost, normalizedUrl) {
  let href = $('link[rel="canonical"]').attr("href") || "";
  if (!href) {
    // fallback: treat normalized URL as canonical candidate
    href = normalizedUrl.replace(/\/$/, "");
  }
  let abs = false, matchesHost = false;
  try {
    const u = new URL(href, normalizedUrl);
    abs = Boolean(u.protocol && u.hostname);
    matchesHost = u.hostname.replace(/^www\./i, "") === originHost;
  } catch {}
  const pct = abs ? (matchesHost ? 1 : 0.7) : 0.3;
  return {
    id: "canonical",
    label: "Canonical URL",
    weight,
    points: Math.round(weight * pct),
    rationale: abs ? (matchesHost ? "Absolute & same host." : "Absolute but cross-host.") : "Relative/missing.",
  };
}

function scoreSchemaPresence(schemaObjects, weight) {
  const count = schemaObjects.length;
  let pct = 0;
  if (count === 0) pct = 0;
  else if (count === 1) pct = 0.55;
  else if (count === 2) pct = 0.8;
  else pct = 1;
  return {
    id: "schemaPresence",
    label: "Schema Presence (JSON-LD)",
    weight,
    points: Math.round(weight * pct),
    rationale: `${count} JSON-LD block(s).`,
  };
}

function scoreTypedSchema(schemaObjects, typeName, weight, label) {
  let present = false;
  for (const o of schemaObjects) {
    const t = o["@type"];
    if (typeof t === "string" && t.toLowerCase() === typeName) present = true;
    else if (Array.isArray(t) && t.map(x => String(x).toLowerCase()).includes(typeName)) present = true;
    if (present) break;
  }
  const pct = present ? 1 : 0;
  return {
    id: `${typeName}Schema`,
    label,
    weight,
    points: Math.round(weight * pct),
    rationale: present ? "Present & detectable." : "Missing.",
  };
}

function scoreBreadcrumb(schemaObjects, weight) {
  return scoreTypedSchema(schemaObjects, "breadcrumblist", weight, "Breadcrumb Schema");
}
function scoreOrganization(schemaObjects, weight) {
  return scoreTypedSchema(schemaObjects, "organization", weight, "Organization Schema");
}
function scorePerson(schemaObjects, weight) {
  return scoreTypedSchema(schemaObjects, "person", weight, "Author/Person Schema");
}

function scoreSocialLinks({ schemaObjects, pageLinks }, weight) {
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
    "wikipedia.org",
  ];
  const seen = new Set();

  const checkUrl = (u) => {
    try {
      const host = new URL(u).hostname.replace(/^www\./i, "");
      for (const s of socialHosts) if (host.endsWith(s)) seen.add(s);
    } catch {}
  };

  // from schema sameAs
  for (const o of schemaObjects) {
    const sa = o.sameAs;
    if (Array.isArray(sa)) sa.forEach(checkUrl);
    else if (typeof sa === "string") checkUrl(sa);
  }
  // from page anchors
  pageLinks.forEach(checkUrl);

  const distinct = seen.size;
  let pct = 0;
  if (distinct === 0) pct = 0;
  else if (distinct === 1) pct = 0.5;
  else pct = 1;

  return {
    id: "socialLinks",
    label: "Social Entity Links",
    weight,
    points: Math.round(weight * pct),
    rationale: `${distinct} verified social host(s).`,
  };
}

function scoreAICrawlSignals($, weight) {
  // Heuristic:
  // - If page sets robots noindex => 0
  // - If we find explicit AI-crawl markers or ping pixels => full
  // - Else if robots/indexable or standard crawl meta present => basic
  const robots = $('meta[name="robots"]').attr("content") || "";
  const xRobots = $('meta[http-equiv="x-robots-tag"]').attr("content") || "";
  const blocked = /noindex|nofollow/i.test(robots) || /noindex|nofollow/i.test(xRobots);

  const aiPing = $('img[src*="ai-crawl-ping"]').length > 0 || $('script[src*="ai-crawl"]').length > 0;
  const aiMeta = $('meta[name="ai-crawl"], meta[name="ai:crawl"], meta[name="ai-ping"]').length > 0;

  let pct = 0;
  if (blocked) pct = 0;
  else if (aiPing || aiMeta) pct = 1;
  else pct = 0.6;

  return {
    id: "aiCrawl",
    label: "AI Crawl Trust Signals",
    weight,
    points: Math.round(weight * pct),
    rationale: blocked ? "Robots blocked." : (aiPing || aiMeta ? "Explicit AI crawl signals." : "Indexable; no explicit AI signals."),
  };
}

function scoreContentDepth($, weight) {
  // Rough word count (exclude script/style/nav etc.)
  const clone = $("body").clone();
  clone.find("script, style, noscript, nav, footer, header, svg").remove();
  const text = clone.text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;

  let pct = 0;
  if (words < 300) pct = 0;
  else if (words < 800) pct = 0.5;
  else if (words < 1200) pct = 0.8;
  else pct = 1;

  return {
    id: "contentDepth",
    label: "Content Depth & Context",
    weight,
    points: Math.round(weight * pct),
    rationale: `~${words} words.`,
  };
}

function scoreInternalLinks(pageLinks, weight, originHost) {
  let total = 0, internal = 0;
  for (const href of pageLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      total++;
      const host = u.hostname.replace(/^www\./i, "");
      if (host === originHost) internal++;
    } catch {}
  }
  const ratio = total ? internal / total : 0;
  // Reward density more than absolute total
  let pct = 0;
  if (total === 0) pct = 0;
  else if (ratio < 0.2) pct = 0.3;
  else if (ratio < 0.5) pct = 0.6;
  else pct = 1;

  return {
    id: "internalLinks",
    label: "Internal Links / Graph Density",
    weight,
    points: Math.round(weight * pct),
    rationale: `${internal}/${total} links internal (ratio ${ratio.toFixed(2)}).`,
  };
}

function scoreExternalLinks(pageLinks, weight, originHost) {
  const seen = new Set();
  for (const href of pageLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host !== originHost) seen.add(host);
    } catch {}
  }
  const distinct = seen.size;
  let pct = 0;
  if (distinct === 0) pct = 0;
  else if (distinct < 3) pct = 0.6;
  else pct = 1;

  return {
    id: "externalLinks",
    label: "External Outbound Links",
    weight,
    points: Math.round(weight * pct),
    rationale: `${distinct} distinct outbound domains.`,
  };
}

function scoreBranding($, weight) {
  const hasFavicon =
    $('link[rel="icon"]').length > 0 ||
    $('link[rel="shortcut icon"]').length > 0 ||
    $('link[rel="apple-touch-icon"]').length > 0;
  const hasOGImage = $('meta[property="og:image"]').attr("content");
  const pct = (hasFavicon ? 0.5 : 0) + (hasOGImage ? 0.5 : 0);
  return {
    id: "branding",
    label: "Favicon & OG Branding",
    weight,
    points: Math.round(weight * pct),
    rationale: `${hasFavicon ? "Favicon ✓" : "Favicon ×"}; ${hasOGImage ? "OG image ✓" : "OG image ×"}.`,
  };
}

// -------------------------
// Main request handler (API)
// -------------------------
export default async function handler(req, res) {
  // --- CORS (explicit allowlist + preflight) ---
  const allowedOrigins = [
    "https://exmxc.ai",
    "https://www.exmxc.ai",
    "https://preview.webflow.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // safe default for public demo
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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
        validateStatus: (s) => s >= 200 && s < 400,
      });
      html = resp.data;
    } catch (e) {
      return res.status(500).json({
        error: "Failed to fetch URL",
        details: e.message || "Request blocked or timed out",
        url: normalized,
      });
    }

    const $ = cheerio.load(html);

    // Collect page links & schema
    const pageLinks = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean);

    const ldBlocks = $("script[type='application/ld+json']")
      .map((_, el) => $(el).contents().text())
      .get();

    const schemaObjects = ldBlocks.flatMap(tryParseJSON);

    // ---- Compute all signals
    const signals = [];

    signals.push(scoreTitle($, WEIGHTS.title));
    signals.push(scoreMetaDescription($, WEIGHTS.meta));
    signals.push(scoreCanonical($, WEIGHTS.canonical, originHost, normalized));

    signals.push(scoreSchemaPresence(schemaObjects, WEIGHTS.schemaPresence));
    signals.push(scoreOrganization(schemaObjects, WEIGHTS.orgSchema));
    signals.push(scoreBreadcrumb(schemaObjects, WEIGHTS.breadcrumbSchema));
    signals.push(scorePerson(schemaObjects, WEIGHTS.personSchema));

    signals.push(scoreSocialLinks({ schemaObjects, pageLinks }, WEIGHTS.socialLinks));
    signals.push(scoreAICrawlSignals($, WEIGHTS.aiCrawl));
    signals.push(scoreContentDepth($, WEIGHTS.contentDepth));
    signals.push(scoreInternalLinks(pageLinks, WEIGHTS.internalLinks, originHost));
    signals.push(scoreExternalLinks(pageLinks, WEIGHTS.externalLinks, originHost));
    signals.push(scoreBranding($, WEIGHTS.branding));

    // Sum to 100 (weights already normalized)
    const entityScore = clamp(
      signals.reduce((acc, s) => acc + (s.points || 0), 0),
      0,
      100
    );

    const entityTier = tierFor(entityScore);

    // Helpful top-line fields
    const title = ($("title").first().text() || "").trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const canonical =
      $('link[rel="canonical"]').attr("href") || normalized.replace(/\/$/, "");

    // Response
    return res.status(200).json({
      success: true,
      url: normalized,
      hostname: originHost,
      entityScore,
      entityTier,
      title,
      canonical,
      description,
      signals,          // detailed per-signal breakdown (id, label, weight, points, rationale)
      weights: WEIGHTS, // exposed for the frontend UI
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
