// /shared/scoring.js
// Core scoring logic for EEI audit
import { WEIGHTS, SOCIAL_HOSTS } from "./weights.js";

/* ---------- Helpers ---------- */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function tierFromScore(score) {
  if (score >= 90) return "Platinum Entity";
  if (score >= 70) return "Gold Entity";
  if (score >= 50) return "Silver Entity";
  if (score >= 30) return "Bronze Entity";
  return "Obscure Entity";
}

/* ---------- Scoring Functions ---------- */

export function scoreTitle($) {
  const title = ($("title").first().text() || "").trim();
  let points = 0, notes = "Missing";
  if (title) {
    const isShort = title.length < 15;
    const hasSeparator = / \| | - /.test(title);
    if (isShort) { points = 5; notes = "Present but vague/short"; }
    else if (hasSeparator || title.length >= 30) { points = 10; notes = "Specific & contextual"; }
    else { points = 7; notes = "Decent clarity"; }
  }
  return { key: "Title Presence & Clarity", points, max: WEIGHTS.title, notes, raw: { title } };
}

export function scoreMetaDescription($) {
  const md = $('meta[name="description"]').attr("content") ||
              $('meta[property="og:description"]').attr("content") || "";
  let points = 0, notes = "Missing";
  if (md) {
    if (md.length < 80) { points = 5; notes = "Present but short/weak"; }
    else { points = 10; notes = "Descriptive & specific"; }
  }
  return { key: "Meta Description", points, max: WEIGHTS.metaDescription, notes, raw: { metaDescription: md } };
}

export function scoreCanonical($, normalizedUrl) {
  const href = ($('link[rel="canonical"]').attr("href") || "").trim();
  let points = 0, notes = "Missing";
  if (href) {
    try {
      const can = new URL(href, normalizedUrl);
      const abs = can.protocol && can.hostname;
      const clean = abs && (can.origin === new URL(normalizedUrl).origin) && !/[?#]/.test(can.href);
      points = clean ? 10 : 5;
      notes = clean ? "Clean absolute canonical" : "Present but not clean/absolute";
    } catch { points = 3; notes = "Present but invalid URL"; }
  }
  return { key: "Canonical URL", points, max: WEIGHTS.canonical, notes, raw: { canonical: href || null } };
}

export function scoreSchemaPresence(schemaObjects) {
  const count = schemaObjects.length;
  const ratio = clamp(Math.min(count, 2) / 2, 0, 1);
  const points = Math.round(ratio * WEIGHTS.schemaPresence);
  const notes = count === 0 ? "No JSON-LD" : count === 1 ? "1 schema block" : "2+ schema blocks";
  return { key: "Schema Presence", points, max: WEIGHTS.schemaPresence, notes, raw: { schemaBlocks: count } };
}

export function scoreOrgSchema(schemaObjects) {
  const org = schemaObjects.find(o => {
    const t = o["@type"]; return t === "Organization" || (Array.isArray(t) && t.includes("Organization"));
  });
  let points = 0, notes = "Missing";
  if (org) {
    const hasName = typeof org.name === "string" && org.name.trim();
    const hasUrl = typeof org.url === "string" && org.url.trim();
    if (hasName && hasUrl) { points = WEIGHTS.orgSchema; notes = "Present & valid"; }
    else { points = Math.round(WEIGHTS.orgSchema * 0.5); notes = "Present but incomplete"; }
  }
  return { key: "Organization Schema", points, max: WEIGHTS.orgSchema, notes, raw: org ? { name: org.name || null, url: org.url || null } : null };
}

export function scoreBreadcrumbSchema(schemaObjects) {
  const crumb = schemaObjects.find(o => {
    const t = o["@type"]; return t === "BreadcrumbList" || (Array.isArray(t) && t.includes("BreadcrumbList"));
  });
  const points = crumb ? WEIGHTS.breadcrumbSchema : 0;
  const notes = crumb ? "Present" : "Missing";
  return { key: "Breadcrumb Schema", points, max: WEIGHTS.breadcrumbSchema, notes, raw: crumb || null };
}

export function scoreAuthorPerson(schemaObjects, $) {
  const person = schemaObjects.find(o => {
    const t = o["@type"]; return t === "Person" || (Array.isArray(t) && t.includes("Person"));
  });
  const metaAuthor = $('meta[name="author"]').attr("content") || $('a[rel="author"]').text() || "";
  let points = 0, notes = "Missing";
  if (person) { points = WEIGHTS.authorPerson; notes = "Person schema present"; }
  else if (metaAuthor) { points = Math.round(WEIGHTS.authorPerson * 0.5); notes = "Author meta present"; }
  return { key: "Author/Person Schema", points, max: WEIGHTS.authorPerson, notes, raw: { person: !!person, metaAuthor: metaAuthor || null } };
}

export function scoreSocialLinks(schemaObjects, pageLinks) {
  const seen = new Set();
  const add = u => { try {
      const host = new URL(u).hostname.replace(/^www\./i, "");
      if (SOCIAL_HOSTS.some(s => host.endsWith(s))) seen.add(host);
  } catch {} };
  schemaObjects.forEach(o => {
    const sa = o.sameAs;
    if (Array.isArray(sa)) sa.forEach(add);
    else if (typeof sa === "string") add(sa);
  });
  pageLinks.forEach(add);
  const count = seen.size;
  let points = 0, notes = "None found";
  if (count >= 3) { points = WEIGHTS.socialLinks; notes = "Strong set (3+)"; }
  else if (count >= 1) { points = Math.round(WEIGHTS.socialLinks * 0.5); notes = "Partial (1–2)"; }
  return { key: "Social Entity Links", points, max: WEIGHTS.socialLinks, notes, raw: { distinctSocialHosts: Array.from(seen) } };
}

export function scoreAICrawlSignals($) {
  const robots = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const allowIndex = robots === "" || /index/.test(robots);
  const aiPing = $('img[src*="ai-crawl-ping"], img[src*="crawl-ping"]').length > 0;
  let points = 0, notes = "Blocked/unknown";
  if (!allowIndex) { points = 0; notes = "Robots meta blocks indexing"; }
  else if (aiPing) { points = WEIGHTS.aiCrawl; notes = "Explicit crawl ping"; }
  else { points = Math.round(WEIGHTS.aiCrawl * 0.6); notes = "Indexable, no explicit ping"; }
  return { key: "AI Crawl Trust Signals", points, max: WEIGHTS.aiCrawl, notes, raw: { robots, aiPing } };
}

export function scoreContentDepth($) {
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  let points = 0, notes = "< 300 words";
  if (words >= 1200) { points = WEIGHTS.contentDepth; notes = "Deep context"; }
  else if (words >= 300) { points = Math.round(WEIGHTS.contentDepth * 0.5); notes = "Moderate"; }
  return { key: "Content Depth & Context", points, max: WEIGHTS.contentDepth, notes, raw: { wordCount: words } };
}

export function scoreInternalLinks(pageLinks, originHost) {
  let total = 0, internal = 0;
  for (const href of pageLinks) {
    total++;
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host === originHost) internal++;
    } catch {}
  }
  const ratio = total ? internal / total : 0;
  let points = 0, notes = "No internal links";
  if (ratio >= 0.5 && internal >= 10) { points = WEIGHTS.internalLinks; notes = "Strong network"; }
  else if (ratio >= 0.2 && internal >= 3) { points = Math.round(WEIGHTS.internalLinks * 0.5); notes = "Some internal linking"; }
  return { key: "Internal Link / Graph Density", points, max: WEIGHTS.internalLinks, notes, raw: { totalLinks: total, internalLinks: internal, internalRatio: Number(ratio.toFixed(3)) } };
}

export function scoreExternalLinks(pageLinks, originHost) {
  const externalHosts = new Set();
  for (const href of pageLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host !== originHost) externalHosts.add(host);
    } catch {}
  }
  const count = externalHosts.size;
  let points = 0, notes = "No outbound links";
  if (count >= 1) { points = WEIGHTS.externalLinks; notes = "Outbound credibility present"; }
  return { key: "External Outbound Links", points, max: WEIGHTS.externalLinks, notes, raw: { distinctOutboundHosts: Array.from(externalHosts).slice(0, 20), count } };
}

export function scoreFaviconOg($) {
  const favicon = $('link[rel="icon"]').attr("href") || $('link[rel="shortcut icon"]').attr("href") || "";
  const ogImg = $('meta[property="og:image"]').attr("content") || "";
  let points = 0, notes = "Missing";
  if (favicon || ogImg) { points = WEIGHTS.faviconOg; notes = "Branding present"; }
  return { key: "Favicon & OG Branding", points, max: WEIGHTS.faviconOg, notes, raw: { favicon: favicon || null, ogImage: ogImg || null } };
}
