// /shared/scoring.js — EEI v3.0 Modular Scoring System (TrailGenic × exmxc.ai)

import { WEIGHTS } from "./weights.js";

/* ================================
   UTILITIES
   ================================ */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ================================
   CORE SCORING FUNCTIONS
   ================================ */

// --- Meta Layer (15 pts total) ---
export function scoreTitle($) {
  const title = ($("title").first().text() || "").trim();
  let points = 0, notes = "Missing";

  if (title) {
    const len = title.length;
    const hasSeparator = / \| | - /.test(title);
    if (len >= 30 && hasSeparator) {
      points = WEIGHTS.title;
      notes = "Specific & contextual";
    } else if (len >= 15) {
      points = Math.round(WEIGHTS.title * 0.7);
      notes = "Present but generic";
    } else {
      points = Math.round(WEIGHTS.title * 0.4);
      notes = "Weak or too short";
    }
  }

  return { key: "Title Precision", points, max: WEIGHTS.title, notes, raw: { title } };
}

export function scoreMetaDescription($) {
  const md =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") || "";
  let points = 0, notes = "Missing";

  if (md) {
    const len = md.length;
    if (len >= 120) {
      points = WEIGHTS.metaDescription;
      notes = "Descriptive & complete";
    } else if (len >= 60) {
      points = Math.round(WEIGHTS.metaDescription * 0.7);
      notes = "Moderate depth";
    } else {
      points = Math.round(WEIGHTS.metaDescription * 0.4);
      notes = "Too short";
    }
  }

  return { key: "Meta Description Integrity", points, max: WEIGHTS.metaDescription, notes, raw: { meta: md } };
}

export function scoreCanonical($, normalizedUrl) {
  const href = ($('link[rel="canonical"]').attr("href") || "").trim();
  let points = 0, notes = "Missing";

  if (href) {
    try {
      const can = new URL(href, normalizedUrl);
      const clean = can.origin === new URL(normalizedUrl).origin && !/[?#]/.test(can.href);
      points = clean ? WEIGHTS.canonical : Math.round(WEIGHTS.canonical * 0.5);
      notes = clean ? "Clean absolute canonical" : "Present but inconsistent";
    } catch {
      points = Math.round(WEIGHTS.canonical * 0.3);
      notes = "Invalid canonical URL";
    }
  }

  return { key: "Canonical Clarity", points, max: WEIGHTS.canonical, notes, raw: { canonical: href } };
}

// --- Schema Layer (30 pts total) ---
export function scoreSchemaPresence(schemaObjects) {
  const count = schemaObjects.length;
  const ratio = clamp(Math.min(count, 3) / 3, 0, 1);
  const points = Math.round(ratio * WEIGHTS.schemaPresence);
  const notes =
    count === 0 ? "No JSON-LD found" :
    count === 1 ? "1 schema block" : "Multiple schema blocks";

  return { key: "Schema Presence & Validity", points, max: WEIGHTS.schemaPresence, notes, raw: { schemaBlocks: count } };
}

export function scoreOrgSchema(schemaObjects) {
  const org = schemaObjects.find(o => o["@type"] === "Organization" || (Array.isArray(o["@type"]) && o["@type"].includes("Organization")));
  let points = 0, notes = "Missing";

  if (org) {
    const hasName = org.name && org.name.trim();
    const hasUrl = org.url && org.url.trim();
    if (hasName && hasUrl) {
      points = WEIGHTS.orgSchema;
      notes = "Organization schema valid";
    } else {
      points = Math.round(WEIGHTS.orgSchema * 0.5);
      notes = "Incomplete organization schema";
    }
  }

  return { key: "Organization Schema", points, max: WEIGHTS.orgSchema, notes, raw: org || null };
}

export function scoreBreadcrumbSchema(schemaObjects) {
  const crumb = schemaObjects.find(o => o["@type"] === "BreadcrumbList" || (Array.isArray(o["@type"]) && o["@type"].includes("BreadcrumbList")));
  const points = crumb ? WEIGHTS.breadcrumbSchema : 0;
  const notes = crumb ? "Breadcrumb schema present" : "Missing";

  return { key: "Breadcrumb Schema", points, max: WEIGHTS.breadcrumbSchema, notes, raw: crumb || null };
}

export function scoreAuthorPerson(schemaObjects, $) {
  const person = schemaObjects.find(o => o["@type"] === "Person" || (Array.isArray(o["@type"]) && o["@type"].includes("Person")));
  const metaAuthor = $('meta[name="author"]').attr("content") || $('a[rel="author"]').text() || "";
  let points = 0, notes = "Missing";

  if (person) {
    points = WEIGHTS.authorPerson;
    notes = "Person schema present";
  } else if (metaAuthor) {
    points = Math.round(WEIGHTS.authorPerson * 0.5);
    notes = "Author meta tag present";
  }

  return { key: "Author/Person Schema", points, max: WEIGHTS.authorPerson, notes, raw: { person: !!person, metaAuthor } };
}

export function scoreSocialLinks(schemaObjects, pageLinks) {
  const SOCIAL_HOSTS = [
    "linkedin.com", "instagram.com", "youtube.com", "x.com", "twitter.com",
    "facebook.com", "threads.net", "tiktok.com", "wikipedia.org", "github.com"
  ];
  const seen = new Set();

  const add = (u) => {
    try {
      const host = new URL(u).hostname.replace(/^www\./i, "");
      if (SOCIAL_HOSTS.some(s => host.endsWith(s))) seen.add(host);
    } catch {}
  };

  schemaObjects.forEach(o => {
    if (Array.isArray(o.sameAs)) o.sameAs.forEach(add);
    else if (o.sameAs) add(o.sameAs);
  });
  pageLinks.forEach(add);

  const count = seen.size;
  let points = 0, notes = "None found";
  if (count >= 3) { points = WEIGHTS.socialLinks; notes = "Strong (3+)"; }
  else if (count >= 1) { points = Math.round(WEIGHTS.socialLinks * 0.5); notes = "Partial (1–2)"; }

  return { key: "Social Entity Links", points, max: WEIGHTS.socialLinks, notes, raw: { distinctSocialHosts: Array.from(seen) } };
}

// --- Trust / Graph Layers (40 pts total) ---
export function scoreInternalLinks(pageLinks, originHost) {
  let total = 0, internal = 0;
  for (const href of pageLinks) {
    total++;
    try {
      const u = new URL(href, `https://${originHost}`);
      if (u.hostname.replace(/^www\./i, "") === originHost) internal++;
    } catch {}
  }
  const ratio = total ? internal / total : 0;
  let points = 0, notes = "No internal links";

  if (ratio >= 0.5 && internal >= 10) { points = WEIGHTS.internalLinks; notes = "Strong lattice"; }
  else if (ratio >= 0.2 && internal >= 3) { points = Math.round(WEIGHTS.internalLinks * 0.5); notes = "Some internal linking"; }

  return { key: "Internal Lattice Integrity", points, max: WEIGHTS.internalLinks, notes, raw: { total, internal, ratio } };
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
  const points = count >= 1 ? WEIGHTS.externalLinks : 0;
  const notes = count >= 1 ? "Outbound credibility present" : "No outbound links";

  return { key: "External Authority Signal", points, max: WEIGHTS.externalLinks, notes, raw: { count, distinctOutboundHosts: Array.from(externalHosts) } };
}

export function scoreAICrawlSignals($) {
  const robots = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const aiPing = $('img[src*="ai-crawl-ping"], img[src*="crawl-ping"]').length > 0;
  const allowIndex = robots === "" || /index/.test(robots);
  let points = 0, notes = "Blocked";

  if (!allowIndex) { points = 0; notes = "Robots block indexing"; }
  else if (aiPing) { points = WEIGHTS.aiCrawl; notes = "Explicit crawl ping"; }
  else { points = Math.round(WEIGHTS.aiCrawl * 0.6); notes = "Indexable, no explicit ping"; }

  return { key: "AI Crawl Fidelity", points, max: WEIGHTS.aiCrawl, notes, raw: { robots, aiPing } };
}

// --- Content / AI Comprehension Layer (15 pts total) ---
export function scoreContentDepth($) {
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text.split(" ").length;
  let points = 0, notes = "Shallow (<300 words)";

  if (words >= 1200) { points = WEIGHTS.contentDepth; notes = "Deep context"; }
  else if (words >= 300) { points = Math.round(WEIGHTS.contentDepth * 0.5); notes = "Moderate"; }

  return { key: "Inference Efficiency", points, max: WEIGHTS.contentDepth, notes, raw: { wordCount: words } };
}

export function scoreFaviconOg($) {
  const favicon =
    $('link[rel="icon"]').attr("href") ||
    $('link[rel="shortcut icon"]').attr("href") || "";
  const ogImg = $('meta[property="og:image"]').attr("content") || "";
  const points = favicon || ogImg ? WEIGHTS.faviconOg : 0;
  const notes = favicon || ogImg ? "Branding consistent" : "Missing";

  return { key: "Brand & Technical Consistency", points, max: WEIGHTS.faviconOg, notes, raw: { favicon, ogImage: ogImg } };
}

/* ================================
   EVOLUTIONARY STAGE (EEI v3.0)
   ================================ */

export function tierFromScore(score) {
  if (score >= 80) {
    return {
      stage: "☀️ Sovereign Entity",
      verb: "Maintain",
      description:
        "Self-propagating identity. Schema-dense and trusted across crawlers.",
      coreFocus:
        "Maintain parity, monitor crawl fidelity, and evolve schema depth."
    };
  } else if (score >= 60) {
    return {
      stage: "🌕 Structured Entity",
      verb: "Expand",
      description:
        "AI reconstructs identity reliably. Schema diversity and internal lattice aligned.",
      coreFocus:
        "Build graph authority, deepen relationships, expand structured coverage."
    };
  } else if (score >= 40) {
    return {
      stage: "🌗 Visible Entity",
      verb: "Clarify",
      description:
        "Recognized but inconsistent. Schema present but incomplete.",
      coreFocus:
        "Standardize structure, fix canonicals, and strengthen schema links."
    };
  } else {
    return {
      stage: "🌑 Emergent Entity",
      verb: "Define",
      description:
        "Early-stage identity forming. Schema sparse; AI relies on guesses.",
      coreFocus:
        "Clarify your signal. Add foundational meta + first JSON-LD."
    };
  }
}
