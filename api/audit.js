// api/audit.js — Phase 2 : exmxc.ai | Entity Engineering™ Audit
import axios from "axios";
import * as cheerio from "cheerio";

/* ---------- Helper Utils ---------- */
const UA = "Mozilla/5.0 (compatible; exmxc-audit/2.0; +https://exmxc.ai)";

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
function daysSince(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return Infinity;
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/* ---------- Scoring Modules ---------- */
function scoreTitle(title) {
  if (!title) return { points: 0 };
  const len = title.length;
  if (len < 10) return { points: 3 };
  if (len < 30) return { points: 7 };
  return { points: 10 };
}

function scoreDescription(desc) {
  if (!desc) return { points: 0 };
  const len = desc.split(" ").length;
  if (len < 5) return { points: 3 };
  if (len < 15) return { points: 7 };
  return { points: 10 };
}

function scoreCanonical(canonical, origin) {
  if (!canonical) return { points: 0 };
  const ok = canonical.startsWith("http") && canonical.includes(origin);
  return { points: ok ? 10 : 5 };
}

function scoreSchema(schemaObjects) {
  const count = schemaObjects.length;
  if (count === 0) return { points: 0 };
  if (count === 1) return { points: 10 };
  return { points: 20 };
}

function scoreOrg(schemaObjects) {
  const hasOrg = schemaObjects.some(
    (o) => o["@type"] === "Organization" || (Array.isArray(o["@type"]) && o["@type"].includes("Organization"))
  );
  return { points: hasOrg ? 10 : 0 };
}

function scoreBreadcrumb(schemaObjects) {
  const hasBC = schemaObjects.some(
    (o) => o["@type"] === "BreadcrumbList" || (Array.isArray(o["@type"]) && o["@type"].includes("BreadcrumbList"))
  );
  return { points: hasBC ? 10 : 0 };
}

function scorePerson(schemaObjects) {
  const hasP = schemaObjects.some(
    (o) => o["@type"] === "Person" || (Array.isArray(o["@type"]) && o["@type"].includes("Person"))
  );
  return { points: hasP ? 10 : 0 };
}

function scoreSocial(schemaObjects) {
  const sameAs = schemaObjects.flatMap((o) =>
    Array.isArray(o.sameAs) ? o.sameAs : o.sameAs ? [o.sameAs] : []
  );
  const count = sameAs.length;
  if (count === 0) return { points: 0 };
  if (count < 3) return { points: 3 };
  return { points: 5 };
}

function scoreAICrawl($) {
  const robots = $('meta[name="robots"]').attr("content") || "";
  if (/noindex|nofollow/i.test(robots)) return { points: 0 };
  const aiPing = $('meta[name="ai-crawl"]').length || $('script[src*="ai-crawl"]').length;
  return { points: aiPing ? 5 : 3 };
}

function scoreContent($) {
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text.split(" ").length;
  if (words < 300) return { points: 0 };
  if (words < 800) return { points: 5 };
  return { points: 10 };
}

function scoreLinks(allLinks, originHost) {
  const total = allLinks.length;
  let internal = 0,
    external = 0;
  for (const href of allLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host === originHost) internal++;
      else external++;
    } catch {}
  }
  const internalPoints = total === 0 ? 0 : internal > 5 ? 10 : internal > 0 ? 5 : 0;
  const externalPoints = external > 2 ? 5 : external > 0 ? 3 : 0;
  return { internal: internalPoints, external: externalPoints, raw: { total, internal, external } };
}

function scoreBranding($) {
  const hasFavicon = $('link[rel="icon"]').attr("href") || $('link[rel="shortcut icon"]').attr("href");
  const hasOG = $('meta[property="og:image"]').attr("content");
  if (hasFavicon && hasOG) return { points: 5 };
  if (hasFavicon || hasOG) return { points: 3 };
  return { points: 0 };
}

/* ---------- Main Handler ---------- */
export default async function handler(req, res) {
  // ✅ CORS + Preflight
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  res.setHeader("Content-Type", "application/json");

  try {
    const input = req.query?.url;
    if (!input) return res.status(400).json({ error: "Missing URL" });
    const normalized = normalizeUrl(input);
    if (!normalized) return res.status(400).json({ error: "Invalid URL" });

    const originHost = hostnameOf(normalized);

    // Fetch target HTML
    const resp = await axios.get(normalized, {
      headers: { "User-Agent": UA },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const html = resp.data;
    const $ = cheerio.load(html);

    /* ---------- Extraction ---------- */
    const title = $("title").first().text().trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const canonical =
      $('link[rel="canonical"]').attr("href") ||
      normalized.replace(/\/$/, "");
    const links = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean);
    const ldBlocks = $("script[type='application/ld+json']")
      .map((_, el) => $(el).contents().text())
      .get();
    const schemaObjects = ldBlocks.flatMap(tryParseJSON);

    /* ---------- Apply Scoring ---------- */
    const sTitle = scoreTitle(title);
    const sDesc = scoreDescription(description);
    const sCanon = scoreCanonical(canonical, originHost);
    const sSchema = scoreSchema(schemaObjects);
    const sOrg = scoreOrg(schemaObjects);
    const sBreadcrumb = scoreBreadcrumb(schemaObjects);
    const sPerson = scorePerson(schemaObjects);
    const sSocial = scoreSocial(schemaObjects);
    const sAICrawl = scoreAICrawl($);
    const sContent = scoreContent($);
    const sLinks = scoreLinks(links, originHost);
    const sBrand = scoreBranding($);

    const rawScore =
      sTitle.points +
      sDesc.points +
      sCanon.points +
      sSchema.points +
      sOrg.points +
      sBreadcrumb.points +
      sPerson.points +
      sSocial.points +
      sAICrawl.points +
      sContent.points +
      sLinks.internal +
      sLinks.external +
      sBrand.points;

    const normalizedEEI = Math.round((rawScore / 120) * 100);

    /* ---------- Tier Label ---------- */
    const tier =
      normalizedEEI >= 90
        ? "Platinum Entity"
        : normalizedEEI >= 70
        ? "Gold Entity"
        : normalizedEEI >= 50
        ? "Silver Entity"
        : normalizedEEI >= 30
        ? "Bronze Entity"
        : "Obscure Entity";

    /* ---------- Output ---------- */
    res.status(200).json({
      success: true,
      url: normalized,
      hostname: originHost,
      entityScore: normalizedEEI,
      entityTier: tier,
      metrics: {
        title: sTitle,
        description: sDesc,
        canonical: sCanon,
        schema: sSchema,
        organization: sOrg,
        breadcrumb: sBreadcrumb,
        person: sPerson,
        social: sSocial,
        aiCrawl: sAICrawl,
        content: sContent,
        links: sLinks,
        branding: sBrand,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Audit Error:", err.message);
    res.status(500).json({ error: err.message || "Internal Error" });
  }
}
