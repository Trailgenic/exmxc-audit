// /api/audit.js — EEI v5 (standalone, single URL audit)

import { URL } from "url";

/* ---------------- Helpers ---------------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeOrigin(req, res) {
  const origin = req.headers.origin || req.headers.referer;
  let normalized = "*";

  try {
    if (origin && origin !== "null") {
      normalized = new URL(origin).origin;
    }
  } catch {
    normalized = "*";
  }

  res.setHeader("Access-Control-Allow-Origin", normalized);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (normalized !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

/* ---------------- V5 Weights & Tiers ---------------- */

const V5_SIGNAL_WEIGHTS = {
  "Title Precision": 3,
  "Meta Description Integrity": 3,
  "Canonical Clarity": 2,
  "Brand & Technical Consistency": 2,

  "Schema Presence & Validity": 10,
  "Organization Schema": 8,
  "Breadcrumb Schema": 7,
  "Author/Person Schema": 5,

  "Social Entity Links": 5,
  "Internal Lattice Integrity": 20,
  "External Authority Signal": 15,
  "AI Crawl Fidelity": 10,
  "Inference Efficiency": 15,
};

const V5_TIER_MAP = {
  "Title Precision": "tier3",
  "Meta Description Integrity": "tier3",
  "Canonical Clarity": "tier3",
  "Brand & Technical Consistency": "tier3",

  "Schema Presence & Validity": "tier2",
  "Organization Schema": "tier2",
  "Breadcrumb Schema": "tier2",
  "Author/Person Schema": "tier2",

  "Social Entity Links": "tier1",
  "Internal Lattice Integrity": "tier1",
  "External Authority Signal": "tier1",
  "AI Crawl Fidelity": "tier1",
  "Inference Efficiency": "tier1",
};

const V5_TIER_LABELS = {
  tier1: "Entity comprehension & trust",
  tier2: "Structural data fidelity",
  tier3: "Page-level hygiene",
};

const TOTAL_V5_WEIGHT = Object.values(V5_SIGNAL_WEIGHTS).reduce(
  (s, w) => s + w,
  0
);

/* --------- V5 Stage Mapping (local tierFromScore) --------- */

function tierFromScore(score) {
  if (score >= 80) {
    return {
      stage: "☀️ Sovereign Entity",
      verb: "Maintain",
      description:
        "Self-propagating identity. Schema-dense and trusted across crawlers.",
      coreFocus:
        "Maintain parity, monitor crawl fidelity, and evolve schema depth.",
    };
  } else if (score >= 60) {
    return {
      stage: "🌕 Structured Entity",
      verb: "Expand",
      description:
        "AI reconstructs identity reliably. Schema diversity and internal lattice aligned.",
      coreFocus:
        "Build graph authority, deepen relationships, expand structured coverage.",
    };
  } else if (score >= 40) {
    return {
      stage: "🌗 Visible Entity",
      verb: "Clarify",
      description:
        "Recognized but inconsistent. Schema present but incomplete.",
      coreFocus:
        "Standardize structure, fix canonicals, and strengthen schema links.",
    };
  } else {
    return {
      stage: "🌑 Emergent Entity",
      verb: "Define",
      description:
        "Early-stage identity forming. Schema sparse; AI relies on guesses.",
      coreFocus:
        "Clarify your signal. Add foundational meta + first JSON-LD.",
    };
  }
}

/* ---------------- Crawl + Parse ---------------- */

async function crawlURL(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; exmxc-eei/1.0; +https://exmxc.ai)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  const html = await res.text();
  const hostname = new URL(url).hostname.replace(/^www\./i, "");

  return { url, hostname, html };
}

function extractBetween(regex, html) {
  const m = html.match(regex);
  return m ? m[1].trim() : "";
}

function extractSignals(html, url) {
  const u = new URL(url);
  const originHost = u.hostname.replace(/^www\./i, "");

  const title = extractBetween(/<title[^>]*>([^<]+)<\/title>/i, html);
  const metaDesc =
    extractBetween(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      html
    ) ||
    extractBetween(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      html
    );

  const canonicalHref = extractBetween(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    html
  );

  const faviconHref =
    extractBetween(
      /<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["'][^>]*>/i,
      html
    ) ||
    extractBetween(
      /<link[^>]+rel=["']shortcut icon["'][^>]+href=["']([^"']+)["'][^>]*>/i,
      html
    );

  const ogImage =
    extractBetween(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      html
    ) || "";

  const robots =
    extractBetween(
      /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      html
    ).toLowerCase() || "";

  const aiPing = /img[^>]+src=["'][^"']*(ai-crawl-ping|crawl-ping)[^"']*["']/i.test(
    html
  );

  // JSON-LD blocks (very simple parser)
  const ldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const schemaBlocks = [];
  for (const m of ldMatches) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) schemaBlocks.push(...parsed);
      else schemaBlocks.push(parsed);
    } catch {
      // ignore bad JSON
    }
  }

  const hasOrg = schemaBlocks.some((o) => {
    const t = o["@type"];
    if (!t) return false;
    if (typeof t === "string") return t === "Organization";
    if (Array.isArray(t)) return t.includes("Organization");
    return false;
  });

  const hasBreadcrumb = schemaBlocks.some((o) => {
    const t = o["@type"];
    if (!t) return false;
    if (typeof t === "string") return t === "BreadcrumbList";
    if (Array.isArray(t)) return t.includes("BreadcrumbList");
    return false;
  });

  const hasPerson = schemaBlocks.some((o) => {
    const t = o["@type"];
    if (!t) return false;
    if (typeof t === "string") return t === "Person";
    if (Array.isArray(t)) return t.includes("Person");
    return false;
  });

  const metaAuthor = extractBetween(
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    html
  );

  // All hrefs
  const hrefMatches = [
    ...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi),
  ];
  const hrefs = hrefMatches.map((m) => m[1]);

  // Social links
  const SOCIAL_HOSTS = [
    "linkedin.com",
    "instagram.com",
    "youtube.com",
    "x.com",
    "twitter.com",
    "facebook.com",
    "threads.net",
    "tiktok.com",
    "wikipedia.org",
    "github.com",
  ];

  const socialHosts = new Set();
  const addHost = (h) => {
    try {
      const host = new URL(h, url).hostname.replace(/^www\./i, "");
      if (SOCIAL_HOSTS.some((s) => host.endsWith(s))) {
        socialHosts.add(host);
      }
    } catch {
      // ignore
    }
  };

  // from hrefs
  hrefs.forEach(addHost);
  // from sameAs in schema
  schemaBlocks.forEach((o) => {
    if (Array.isArray(o.sameAs)) o.sameAs.forEach(addHost);
    else if (o.sameAs) addHost(o.sameAs);
  });

  // Internal vs external links
  let totalLinks = 0;
  let internal = 0;
  const externalHosts = new Set();

  for (const href of hrefs) {
    try {
      const linkUrl = new URL(href, url);
      const host = linkUrl.hostname.replace(/^www\./i, "");
      totalLinks++;
      if (host === originHost) {
        internal++;
      } else {
        externalHosts.add(host);
      }
    } catch {
      // ignore
    }
  }

  // Content depth (rough)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = text ? text.split(" ").length : 0;

  const signals = [];

  /* ---- Title Precision ---- */
  let titlePoints = 0;
  if (title) {
    const len = title.length;
    const hasSep = / \| | - /.test(title);
    if (len >= 30 && hasSep) titlePoints = 3;
    else if (len >= 15) titlePoints = 2;
    else titlePoints = 1;
  }
  signals.push({
    key: "Title Precision",
    points: titlePoints,
    max: 3,
    notes: title ? "Present" : "Missing",
  });

  /* ---- Meta Description Integrity ---- */
  let mdPoints = 0;
  if (metaDesc) {
    const len = metaDesc.length;
    if (len >= 120) mdPoints = 3;
    else if (len >= 60) mdPoints = 2;
    else mdPoints = 1;
  }
  signals.push({
    key: "Meta Description Integrity",
    points: mdPoints,
    max: 3,
    notes: metaDesc ? "Present" : "Missing",
  });

  /* ---- Canonical Clarity ---- */
  let canPoints = 0;
  if (canonicalHref) {
    try {
      const canUrl = new URL(canonicalHref, url);
      const sameHost =
        canUrl.hostname.replace(/^www\./i, "") === originHost &&
        !/[?#]/.test(canUrl.href);
      canPoints = sameHost ? 2 : 1;
    } catch {
      canPoints = 1;
    }
  }
  signals.push({
    key: "Canonical Clarity",
    points: canPoints,
    max: 2,
    notes: canonicalHref ? "Present" : "Missing",
  });

  /* ---- Brand & Technical Consistency ---- */
  const brandPoints = faviconHref || ogImage ? 2 : 0;
  signals.push({
    key: "Brand & Technical Consistency",
    points: brandPoints,
    max: 2,
    notes: faviconHref || ogImage ? "Branding present" : "Missing OG/favicon",
  });

  /* ---- Schema Presence & Validity ---- */
  const schemaPoints =
    schemaBlocks.length === 0
      ? 0
      : schemaBlocks.length === 1
      ? 7
      : 10;
  signals.push({
    key: "Schema Presence & Validity",
    points: schemaPoints,
    max: 10,
    notes:
      schemaBlocks.length === 0
        ? "No JSON-LD"
        : `${schemaBlocks.length} JSON-LD block(s)`,
  });

  /* ---- Organization Schema ---- */
  let orgPoints = 0;
  if (hasOrg) orgPoints = 8;
  signals.push({
    key: "Organization Schema",
    points: orgPoints,
    max: 8,
    notes: hasOrg ? "Organization schema present" : "Missing",
  });

  /* ---- Breadcrumb Schema ---- */
  const crumbPoints = hasBreadcrumb ? 7 : 0;
  signals.push({
    key: "Breadcrumb Schema",
    points: crumbPoints,
    max: 7,
    notes: hasBreadcrumb ? "BreadcrumbList present" : "Missing",
  });

  /* ---- Author/Person Schema ---- */
  let authorPoints = 0;
  if (hasPerson) authorPoints = 5;
  else if (metaAuthor) authorPoints = 3;
  signals.push({
    key: "Author/Person Schema",
    points: authorPoints,
    max: 5,
    notes: hasPerson ? "Person schema" : metaAuthor ? "Meta author" : "Missing",
  });

  /* ---- Social Entity Links ---- */
  const socialCount = socialHosts.size;
  let socialPoints = 0;
  if (socialCount >= 3) socialPoints = 5;
  else if (socialCount >= 1) socialPoints = 3;
  signals.push({
    key: "Social Entity Links",
    points: socialPoints,
    max: 5,
    notes:
      socialCount === 0
        ? "No social graph"
        : `${socialCount} distinct social host(s)`,
  });

  /* ---- Internal Lattice Integrity ---- */
  let latticePoints = 0;
  const ratio = totalLinks ? internal / totalLinks : 0;
  if (internal >= 10 && ratio >= 0.5) latticePoints = 20;
  else if (internal >= 3 && ratio >= 0.2) latticePoints = 10;
  signals.push({
    key: "Internal Lattice Integrity",
    points: latticePoints,
    max: 20,
    notes: `${internal} internal / ${totalLinks} total`,
  });

  /* ---- External Authority Signal ---- */
  const extCount = externalHosts.size;
  const extPoints = extCount >= 1 ? 15 : 0;
  signals.push({
    key: "External Authority Signal",
    points: extPoints,
    max: 15,
    notes:
      extCount === 0
        ? "No outbound hosts"
        : `${extCount} distinct outbound host(s)`,
  });

  /* ---- AI Crawl Fidelity ---- */
  let aiPoints = 0;
  const allowIndex = !robots || /index/.test(robots);
  if (!allowIndex) aiPoints = 0;
  else if (aiPing) aiPoints = 10;
  else aiPoints = 6;
  signals.push({
    key: "AI Crawl Fidelity",
    points: aiPoints,
    max: 10,
    notes: !allowIndex
      ? "Robots blocking"
      : aiPing
      ? "Explicit AI crawl ping"
      : "Indexable",
  });

  /* ---- Inference Efficiency (content depth) ---- */
  let infPoints = 0;
  if (wordCount >= 1200) infPoints = 15;
  else if (wordCount >= 300) infPoints = 8;
  signals.push({
    key: "Inference Efficiency",
    points: infPoints,
    max: 15,
    notes: `${wordCount} words`,
  });

  return { signals, meta: { title, metaDesc, canonicalHref, wordCount } };
}

/* ---------------- Main Handler ---------------- */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    normalizeOrigin(req, res);
    return res.status(200).end();
  }

  normalizeOrigin(req, res);
  res.setHeader("Content-Type", "application/json");

  try {
    const input = req.query?.url;
    if (!input || typeof input !== "string" || !input.trim()) {
      return res.status(400).json({ success: false, error: "Missing URL" });
    }

    const normalizedUrl = input.startsWith("http")
      ? input
      : `https://${input}`;

    const crawled = await crawlURL(normalizedUrl);
    const { signals, meta } = extractSignals(crawled.html, normalizedUrl);

    const signalsByKey = {};
    for (const s of signals) {
      if (s && s.key) signalsByKey[s.key] = s;
    }

    let total = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

    for (const [key, weight] of Object.entries(V5_SIGNAL_WEIGHTS)) {
      const sig = signalsByKey[key];
      const strength = sig?.max ? clamp(sig.points / sig.max, 0, 1) : 0;
      const contrib = strength * weight;

      total += contrib;

      const tier = V5_TIER_MAP[key] || "tier3";
      tierRaw[tier] += contrib;
      tierMax[tier] += weight;
    }

    const scale = 100 / TOTAL_V5_WEIGHT;
    const v5Score = clamp(Math.round(total * scale), 0, 100);
    const v5Tier = tierFromScore(v5Score);

    const v5Tiers = {
      tier1: {
        label: V5_TIER_LABELS.tier1,
        raw: tierRaw.tier1,
        maxWeight: tierMax.tier1,
        normalized: tierMax.tier1
          ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2))
          : 0,
      },
      tier2: {
        label: V5_TIER_LABELS.tier2,
        raw: tierRaw.tier2,
        maxWeight: tierMax.tier2,
        normalized: tierMax.tier2
          ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2))
          : 0,
      },
      tier3: {
        label: V5_TIER_LABELS.tier3,
        raw: tierRaw.tier3,
        maxWeight: tierMax.tier3,
        normalized: tierMax.tier3
          ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2))
          : 0,
      },
    };

    return res.status(200).json({
      success: true,
      mode: "EEI v5 (standalone)",
      url: normalizedUrl,
      hostname: crawled.hostname,
      v5Score,
      v5Stage: v5Tier.stage,
      v5Verb: v5Tier.verb,
      v5Description: v5Tier.description,
      v5Focus: v5Tier.coreFocus,
      v5Tiers,
      signals,
      meta,
      timestamp: new Date().toISOString(),
      // simple flag so UI can show mode if needed
      renderMode: "static",
    });
  } catch (err) {
    console.error("EEI v5 error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal EEI v5 error",
      details: err?.message || String(err),
    });
  }
}
