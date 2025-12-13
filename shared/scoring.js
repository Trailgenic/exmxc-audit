// /shared/scoring.js — EEI v5.2
// SOURCE-AWARE: prefers extracted crawl fields, falls back to DOM ($)

import { WEIGHTS } from "./weights.js";

/* ================================
   UTILITIES
   ================================ */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function pick(val, fallback) {
  return val !== undefined && val !== null && val !== ""
    ? val
    : fallback;
}

/* ================================
   Tier 3 — Page Hygiene
   ================================ */

export function scoreTitle($, fields = {}) {
  const title = pick(
    fields.title,
    ($("title").first().text() || "").trim()
  );

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

export function scoreMetaDescription($, fields = {}) {
  const md = pick(
    fields.description,
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  );

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

  return {
    key: "Meta Description Integrity",
    points,
    max: WEIGHTS.metaDescription,
    notes,
    raw: { meta: md }
  };
}

export function scoreCanonical($, normalizedUrl, fields = {}) {
  const href = pick(
    fields.canonicalHref,
    ($('link[rel="canonical"]').attr("href") || "").trim()
  );

  let points = 0, notes = "Missing";

  if (href) {
    try {
      const can = new URL(href, normalizedUrl);
      const sameOrigin = can.origin === new URL(normalizedUrl).origin;
      const clean = sameOrigin && !/[?#]/.test(can.href);

      points = clean ? WEIGHTS.canonical : Math.round(WEIGHTS.canonical * 0.5);
      notes = clean ? "Clean absolute canonical" : "Present but inconsistent";
    } catch {
      points = Math.round(WEIGHTS.canonical * 0.3);
      notes = "Invalid canonical URL";
    }
  }

  return {
    key: "Canonical Clarity",
    points,
    max: WEIGHTS.canonical,
    notes,
    raw: { canonical: href }
  };
}

export function scoreFaviconOg($) {
  const favicon =
    $('link[rel="icon"]').attr("href") ||
    $('link[rel="shortcut icon"]').attr("href") ||
    "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";

  const points = favicon || ogImage ? WEIGHTS.faviconOg : 0;
  const notes = favicon || ogImage ? "Branding consistent" : "Missing";

  return {
    key: "Brand & Technical Consistency",
    points,
    max: WEIGHTS.faviconOg,
    notes,
    raw: { favicon, ogImage }
  };
}

/* ================================
   Tier 2 — Structured Data
   ================================ */

export function scoreSchemaPresence(schemaObjects) {
  const count = schemaObjects.length;
  const ratio = clamp(Math.min(count, 3) / 3, 0, 1);
  const points = Math.round(ratio * WEIGHTS.schemaPresence);

  const notes =
    count === 0 ? "No JSON-LD found" :
    count === 1 ? "1 schema block" :
    "Multiple schema blocks";

  return {
    key: "Schema Presence & Validity",
    points,
    max: WEIGHTS.schemaPresence,
    notes,
    raw: { schemaBlocks: count }
  };
}

export function scoreOrgSchema(schemaObjects) {
  const org = schemaObjects.find(o =>
    o["@type"] === "Organization" ||
    (Array.isArray(o["@type"]) && o["@type"].includes("Organization"))
  );

  let points = 0, notes = "Missing";

  if (org) {
    const name = org.name?.trim();
    const url = org.url?.trim();

    if (name && url) {
      points = WEIGHTS.orgSchema;
      notes = "Organization schema valid";
    } else {
      points = Math.round(WEIGHTS.orgSchema * 0.5);
      notes = "Incomplete organization schema";
    }
  }

  return {
    key: "Organization Schema",
    points,
    max: WEIGHTS.orgSchema,
    notes,
    raw: org || null
  };
}

export function scoreBreadcrumbSchema(schemaObjects) {
  const crumb = schemaObjects.find(o =>
    o["@type"] === "BreadcrumbList" ||
    (Array.isArray(o["@type"]) && o["@type"].includes("BreadcrumbList"))
  );

  return {
    key: "Breadcrumb Schema",
    points: crumb ? WEIGHTS.breadcrumbSchema : 0,
    max: WEIGHTS.breadcrumbSchema,
    notes: crumb ? "Breadcrumb schema present" : "Missing",
    raw: crumb || null
  };
}

export function scoreAuthorPerson(schemaObjects, $) {
  const person = schemaObjects.find(o =>
    o["@type"] === "Person" ||
    (Array.isArray(o["@type"]) && o["@type"].includes("Person"))
  );

  const metaAuthor =
    $('meta[name="author"]').attr("content") ||
    $('a[rel="author"]').text() ||
    "";

  let points = 0, notes = "Missing";

  if (person) {
    points = WEIGHTS.authorPerson;
    notes = "Person schema present";
  } else if (metaAuthor) {
    points = Math.round(WEIGHTS.authorPerson * 0.5);
    notes = "Author meta tag present";
  }

  return {
    key: "Author/Person Schema",
    points,
    max: WEIGHTS.authorPerson,
    notes,
    raw: { person: !!person, metaAuthor }
  };
}

/* ================================
   Social Graph
   ================================ */

export function scoreSocialLinks(schemaObjects, pageLinks) {
  const SOCIAL_HOSTS = [
    "linkedin.com", "instagram.com", "youtube.com", "x.com",
    "twitter.com", "facebook.com", "threads.net",
    "tiktok.com", "wikipedia.org", "github.com"
  ];

  const seen = new Set();

  const add = (url) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
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
  if (count >= 3) {
    points = WEIGHTS.socialLinks;
    notes = "Strong (3+)";
  } else if (count >= 1) {
    points = Math.round(WEIGHTS.socialLinks * 0.5);
    notes = "Partial (1–2)";
  }

  return {
    key: "Social Entity Links",
    points,
    max: WEIGHTS.socialLinks,
    notes,
    raw: { distinctSocialHosts: Array.from(seen) }
  };
}

/* ================================
   Tier 1 — Graph / AI Comprehension
   ================================ */

export function scoreInternalLinks(pageLinks, originHost) {
  let total = 0, internal = 0;

  for (const href of pageLinks) {
    total++;
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./, "");
      if (host === originHost) internal++;
    } catch {}
  }

  const ratio = total ? internal / total : 0;

  let points = 0, notes = "No internal links";

  if (ratio >= 0.5 && internal >= 10) {
    points = WEIGHTS.internalLinks;
    notes = "Strong lattice";
  } else if (ratio >= 0.2 && internal >= 3) {
    points = Math.round(WEIGHTS.internalLinks * 0.5);
    notes = "Some internal linking";
  }

  return {
    key: "Internal Lattice Integrity",
    points,
    max: WEIGHTS.internalLinks,
    notes,
    raw: { total, internal, ratio }
  };
}

export function scoreExternalLinks(pageLinks, originHost) {
  const external = new Set();

  for (const href of pageLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./, "");
      if (host !== originHost) external.add(host);
    } catch {}
  }

  const count = external.size;

  return {
    key: "External Authority Signal",
    points: count >= 1 ? WEIGHTS.externalLinks : 0,
    max: WEIGHTS.externalLinks,
    notes: count >= 1 ? "Outbound credibility present" : "No outbound links",
    raw: { count, distinctOutboundHosts: Array.from(external) }
  };
}

export function scoreAICrawlSignals($) {
  const robots = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const aiPing =
    $('img[src*="ai-crawl-ping"], img[src*="crawl-ping"]').length > 0;

  const allowIndex = robots === "" || /index/.test(robots);

  let points = 0, notes = "Blocked";

  if (!allowIndex) {
    points = 0;
    notes = "Robots block indexing";
  } else if (aiPing) {
    points = WEIGHTS.aiCrawl;
    notes = "Explicit crawl ping";
  } else {
    points = Math.round(WEIGHTS.aiCrawl * 0.6);
    notes = "Indexable, no explicit ping";
  }

  return {
    key: "AI Crawl Fidelity",
    points,
    max: WEIGHTS.aiCrawl,
    notes,
    raw: { robots, aiPing }
  };
}

/* ================================
   Content Depth
   ================================ */

export function scoreContentDepth($, fields = {}) {
  const words = pick(
    fields.wordCount,
    $("body").text().replace(/\s+/g, " ").trim().split(" ").length
  );

  let points = 0, notes = "Shallow (<300 words)";

  if (words >= 1200) {
    points = WEIGHTS.contentDepth;
    notes = "Deep context";
  } else if (words >= 300) {
    points = Math.round(WEIGHTS.contentDepth * 0.5);
    notes = "Moderate";
  }

  return {
    key: "Inference Efficiency",
    points,
    max: WEIGHTS.contentDepth,
    notes,
    raw: { wordCount: words }
  };
}

/* ================================
   EEI STAGE MAPPING
   ================================ */

export function tierFromScore(score) {
  if (score >= 80) {
    return {
      stage: "☀️ Sovereign Entity",
      verb: "Maintain",
      description: "Self-propagating identity. Schema-dense and trusted across crawlers.",
      coreFocus: "Maintain parity, monitor crawl fidelity, and evolve schema depth."
    };
  } else if (score >= 60) {
    return {
      stage: "🌕 Structured Entity",
      verb: "Expand",
      description: "AI reconstructs identity reliably. Schema diversity and internal lattice aligned.",
      coreFocus: "Build graph authority, deepen relationships, expand structured coverage."
    };
  } else if (score >= 40) {
    return {
      stage: "🌗 Visible Entity",
      verb: "Clarify",
      description: "Recognized but inconsistent. Schema present but incomplete.",
      coreFocus: "Standardize structure, fix canonicals, and strengthen schema links."
    };
  } else {
    return {
      stage: "🌑 Emergent Entity",
      verb: "Define",
      description: "Early-stage identity forming. Schema sparse; AI relies on guesses.",
      coreFocus: "Clarify your signal. Add foundational meta + first JSON-LD."
    };
  }
}
