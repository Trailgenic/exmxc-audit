// /api/audit-multi.js — EEI v5.4 Phase 4.4 Multi-Surface Audit
//
// High level:
//   1) Run single-page audit on the requested URL
//   2) Discover additional in-domain surfaces from internal links
//   3) Run single-page audit on top N surfaces
//   4) Resolve them into a unified entity verdict via surfaceResolver

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

import {
  scoreTitle,
  scoreMetaDescription,
  scoreCanonical,
  scoreSchemaPresence,
  scoreOrgSchema,
  scoreBreadcrumbSchema,
  scoreAuthorPerson,
  scoreSocialLinks,
  scoreAICrawlSignals,
  scoreContentDepth,
  scoreInternalLinks,
  scoreExternalLinks,
  scoreFaviconOg,
  tierFromScore,
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";
import { crawlPage } from "./core-scan.js";
import { evaluateOntology } from "../lib/ontologyEngine.js";
import { resolveEntitySurfaces } from "../lib/surfaceResolver.js";

// ---------------------------------------------
// Optional Surface Mapping loader (safe)
// ---------------------------------------------
let mapSurfaceVectors = () => null;
try {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const mod = require("../lib/surfaceMapping.js");
  mapSurfaceVectors = mod.mapSurfaceVectors || mod.default || mapSurfaceVectors;
} catch {
  mapSurfaceVectors = () => null;
}

// ---------------------------------------------
// Load constraint explanations (optional)
// ---------------------------------------------
let constraintExplanations = {};
try {
  const expPath = path.join(
    process.cwd(),
    "ontology",
    "constraintExplanations.json"
  );
  if (fs.existsSync(expPath)) {
    const raw = fs.readFileSync(expPath, "utf-8");
    constraintExplanations = JSON.parse(raw);
  }
} catch {
  constraintExplanations = {};
}

// ---------------------------------------------
// Load constraint severity map (optional)
// ---------------------------------------------
let constraintSeverity = {};
try {
  const sevPath = path.join(
    process.cwd(),
    "ontology",
    "constraintSeverity.json"
  );
  if (fs.existsSync(sevPath)) {
    const raw = fs.readFileSync(sevPath, "utf-8");
    constraintSeverity = JSON.parse(raw);
  }
} catch {
  constraintSeverity = {};
}

/* ================================
   HELPERS
   ================================ */
function normalizeUrl(input) {
  let url = (input || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    return new URL(url).toString();
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

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeHost(host) {
  if (!host) return null;
  return String(host).toLowerCase().replace(/^www\./i, "");
}

// Very light registrable-root approximation
function getRootDomain(host) {
  if (!host) return null;
  const parts = String(host).split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "unknown"];

/* ================================
   SIGNAL → TIER
   ================================ */
const SIGNAL_TIER = {
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

const TIER_LABELS = {
  tier1: "Entity comprehension & trust",
  tier2: "Structural data fidelity",
  tier3: "Page-level hygiene",
};

/* ================================
   ONTOLOGY OVERLAY WEIGHTING
   ================================ */
function applyOntologyOverlay(baseScore, alignment) {
  if (alignment == null || Number.isNaN(alignment)) return baseScore;
  const a = clamp(alignment, 0, 1);
  return clamp(Math.round(baseScore * 0.85 + a * 15), 0, 100);
}

/* ================================
   ONTOLOGY SEVERITY SUMMARY
   ================================ */
function summarizeOntologySeverity(ontology) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };

  if (!ontology) {
    return { counts, topSeverity: null };
  }

  // If summary already present, just normalize it
  if (ontology.severitySummary && ontology.severitySummary.counts) {
    const src = ontology.severitySummary.counts;
    for (const level of Object.keys(counts)) {
      if (typeof src[level] === "number") counts[level] += src[level];
    }

    let top = ontology.severitySummary.topSeverity || null;
    if (!top) {
      for (const level of SEVERITY_ORDER) {
        if (counts[level] > 0) {
          top = level;
          break;
        }
      }
    }
    return { counts, topSeverity: top };
  }

  const failed = Array.isArray(ontology.failedConstraints)
    ? ontology.failedConstraints
    : [];

  for (const fc of failed) {
    const id = fc?.id || null;

    const mapped =
      (id && constraintSeverity[id]?.severity) ||
      fc?.explanation?.severity ||
      fc?.severity ||
      "unknown";

    const key = SEVERITY_ORDER.includes(mapped) ? mapped : "unknown";
    counts[key] += 1;
  }

  let topSeverity = null;
  for (const level of SEVERITY_ORDER) {
    if (counts[level] > 0) {
      topSeverity = level;
      break;
    }
  }

  return { counts, topSeverity };
}

/* ================================
   SINGLE-SURFACE AUDIT (reusable)
   ================================ */
async function runSingleAudit({ url, mode }) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    throw new Error("Invalid URL format");
  }

  const host = hostnameOf(normalized);

  const crawl = await crawlPage({
    url: normalized,
    mode,
  });

  if (crawl.error || !crawl.html) {
    const err = new Error(crawl.error || "Failed to crawl URL");
    err.httpStatus = crawl.status || 500;
    err.crawl = crawl;
    throw err;
  }

  const {
    html,
    title: crawlTitle,
    description: crawlDescription,
    canonicalHref: crawlCanonical,
    pageLinks,
    schemaObjects,
    latestISO,
    mode: resolvedMode,
    status: httpStatus,
    crawlHealth,
    diagnostics: crawlDiagnostics,
  } = crawl;

  const $ = cheerio.load(html);

  /* ---------- Extraction ---------- */
  const title = (crawlTitle || $("title").text() || "").trim();

  const description =
    crawlDescription ||
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  const canonicalHref =
    crawlCanonical ||
    $('link[rel="canonical"]').attr("href") ||
    normalized.replace(/\/$/, "");

  let entityName =
    schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
    schemaObjects.find((o) => o["@type"] === "Person")?.name ||
    (title.includes(" | ")
      ? title.split(" | ")[0]
      : title.split(" - ")[0]) ||
    "";

  /* ---------- Score Signals ---------- */
  const scores = [
    scoreTitle($),
    scoreMetaDescription($),
    scoreCanonical($, normalized),
    scoreSchemaPresence(schemaObjects),
    scoreOrgSchema(schemaObjects),
    scoreBreadcrumbSchema(schemaObjects),
    scoreAuthorPerson(schemaObjects, $),
    scoreSocialLinks(schemaObjects, pageLinks),
    scoreAICrawlSignals($),
    scoreContentDepth($),
    scoreInternalLinks(pageLinks, host),
    scoreExternalLinks(pageLinks, host),
    scoreFaviconOg($),
  ];

  /* ---------- Base Score ---------- */
  let totalRaw = 0;
  const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
  const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

  for (const sig of scores) {
    const safe = clamp(sig.points || 0, 0, sig.max);
    const tier = SIGNAL_TIER[sig.key] || "tier3";
    totalRaw += safe;
    tierRaw[tier] += safe;
    tierMax[tier] += sig.max;
  }

  const entityScoreBase = clamp(
    Math.round((totalRaw * 100) / TOTAL_WEIGHT),
    0,
    100
  );

  /* ---------- Tier Breakdown ---------- */
  const tierScores = {
    tier1: {
      label: TIER_LABELS.tier1,
      raw: tierRaw.tier1,
      maxWeight: tierMax.tier1,
      normalized:
        tierMax.tier1 > 0
          ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2))
          : 0,
    },
    tier2: {
      label: TIER_LABELS.tier2,
      raw: tierRaw.tier2,
      maxWeight: tierMax.tier2,
      normalized:
        tierMax.tier2 > 0
          ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2))
          : 0,
    },
    tier3: {
      label: TIER_LABELS.tier3,
      raw: tierRaw.tier3,
      maxWeight: tierMax.tier3,
      normalized:
        tierMax.tier3 > 0
          ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2))
          : 0,
    },
  };

  /* ================================
     ONTOLOGY ENGINE
     ================================ */
  const ontologyReport = evaluateOntology({
    title,
    canonical: canonicalHref,
    url: crawlHealth?.finalUrl || normalized,
    hostname: host,
    schemaObjects,
    pageLinks,
    scoringOutputs: scores,
    entityName: entityName.trim() || null,
    crawlHealth: crawlHealth || crawlDiagnostics || null,
  });

  /* ---------- Safety Guard ---------- */
  if (!Array.isArray(ontologyReport.failedConstraints)) {
    ontologyReport.failedConstraints = [];
  }

  /* ---------- Inject Constraint Explanations ---------- */
  for (const fc of ontologyReport.failedConstraints) {
    const exp = constraintExplanations?.[fc.id];
    if (exp && typeof fc.explanation === "undefined") {
      // Allow explanations as either strings or full objects
      fc.explanation = exp;
    }
  }

  /* ---------- Ontology Severity Summary ---------- */
  const ontologySeverity = summarizeOntologySeverity(ontologyReport);

  /* ================================
     SURFACE MAPPING (optional)
     ================================ */
  const surfaceVectors = mapSurfaceVectors({
    schemaObjects,
    pageLinks,
    hostname: host,
    canonicalHref,
  });

  /* ---------- Ontology Overlay ---------- */
  const entityScoreOntologyAdjusted = applyOntologyOverlay(
    entityScoreBase,
    ontologyReport.alignmentScore
  );

  const entityScore = entityScoreOntologyAdjusted;
  const entityTier = tierFromScore(entityScore);

  /* ---------- Scoring Bars ---------- */
  const scoringBars = scores.map((r) => ({
    key: r.key,
    points: r.points,
    max: r.max,
    percent: r.max ? Math.round((r.points / r.max) * 100) : 0,
    notes: r.notes,
  }));

  return {
    success: true,
    url: normalized,
    hostname: host,
    entityName: entityName.trim() || null,
    title,
    canonical: canonicalHref,
    description,

    entityScoreBase,
    entityScoreOntologyAdjusted,
    entityScore,

    entityStage: entityTier.stage,
    entityVerb: entityTier.verb,
    entityDescription: entityTier.description,
    entityFocus: entityTier.coreFocus,

    breakdown: scores,
    scoringBars,
    tierScores,

    schemaMeta: {
      schemaBlocks: schemaObjects.length,
      latestISO,
      mode: resolvedMode,
      httpStatus,
    },

    crawlHealth: crawlHealth || crawlDiagnostics || null,

    ontology: ontologyReport,
    ontologySeverity,
    surface: surfaceVectors, // may be null if mapper unavailable
    pageLinks, // kept for surface discovery
  };
}

/* ================================
   DISCOVER IN-DOMAIN SURFACES
   ================================ */
function discoverCandidateUrls(primaryAudit, maxSurfaces) {
  const baseUrl =
    primaryAudit.crawlHealth?.finalUrl ||
    primaryAudit.canonical ||
    primaryAudit.url;

  if (!baseUrl) return [];

  const base = new URL(baseUrl);
  const baseRoot = getRootDomain(normalizeHost(base.hostname));

  const candidates = new Map();

  const links = Array.isArray(primaryAudit.pageLinks)
    ? primaryAudit.pageLinks
    : [];

  for (const link of links) {
    const href = link?.href || link?.url || null;
    if (!href) continue;

    let target;
    try {
      target = new URL(href, base);
    } catch {
      continue;
    }

    const normHost = normalizeHost(target.hostname);
    const root = getRootDomain(normHost);

    // Only stay within same registrable root
    if (!root || root !== baseRoot) continue;

    const pathname = target.pathname || "/";
    const normalizedPath =
      pathname === "" ? "/" : pathname.replace(/\/+$/, "") || "/";

    // Skip homepage (we already audited)
    if (normalizedPath === "/" && normHost === normalizeHost(base.hostname)) {
      continue;
    }

    const key = `${target.protocol}//${target.host}${normalizedPath}`;

    // Simple heuristic weighting: prioritize about/company/corporate/etc.
    let weight = 1;
    if (/\/(about|company|who-we-are)\b/i.test(normalizedPath)) weight += 5;
    if (/\/(corporate|investors?)\b/i.test(normalizedPath)) weight += 4;
    if (/\/(careers|jobs)\b/i.test(normalizedPath)) weight += 2;

    const prev = candidates.get(key);
    candidates.set(key, prev ? Math.max(prev, weight) : weight);
  }

  // Sort by weight desc and pick top (maxSurfaces - 1) because primary already counted
  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, maxSurfaces - 1))
    .map(([urlStr]) => urlStr);
}

/* ================================
   MAIN HANDLER — MULTI-SURFACE
   ================================ */
export default async function handler(req, res) {
  /* ---------- CORS ---------- */
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, x-exmxc-key"
  );
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    /* ---------- Input ---------- */
    const input = req.query?.url;
    if (!input) return res.status(400).json({ error: "Missing URL" });

    const requestedMode =
      req.query?.mode === "static" ? "static" : "rendered";

    const maxSurfaces = (() => {
      const raw = Number(req.query?.maxSurfaces);
      if (Number.isFinite(raw) && raw >= 1 && raw <= 20) return raw;
      return 8;
    })();

    const tolerance = (() => {
      const raw = Number(req.query?.tolerance);
      if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
      return 0.65;
    })();

    /* ---------- Primary Audit ---------- */
    const primaryAudit = await runSingleAudit({
      url: input,
      mode: requestedMode,
    });

    /* ---------- Discover Additional Surfaces ---------- */
    const candidateUrls = discoverCandidateUrls(
      primaryAudit,
      maxSurfaces
    );

    const secondaryAudits = [];
    for (const u of candidateUrls) {
      try {
        const a = await runSingleAudit({ url: u, mode: requestedMode });
        secondaryAudits.push(a);
      } catch (err) {
        // Soft-fail: ignore individual failures
        // eslint-disable-next-line no-console
        console.warn("[audit-multi] Failed to audit surface:", u, err.message);
      }
    }

    const allAudits = [primaryAudit, ...secondaryAudits];

    /* ---------- Multi-Surface Resolution ---------- */
    const unified = resolveEntitySurfaces({
      audits: allAudits,
      tolerance,
    });

    /* ---------- Response ---------- */
    return res.status(200).json({
      success: true,
      requestedUrl: input,
      mode: requestedMode,
      maxSurfaces,
      tolerance,

      primary: primaryAudit,
      surfaces: allAudits,
      unified,

      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.httpStatus || 500;

    return res.status(status).json({
      success: false,
      error: "Internal server error",
      details: err.message || String(err),
      crawl: err.crawl || null,
    });
  }
}
