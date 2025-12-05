// /api/audit.js — EEI v5.6 Phase-5 MULTI-PAGE Crawl
//
// Multi-Page logic:
//   1. Detect root URL of requested site
//   2. Load root-surface mapping from `/ontology/pages.json`
//   3. Generate full URLs for each surface
//   4. Run Single-surface audits on all of them
//   5. Resolve into unified Entity Score + Entity Stage via resolveEntitySurfaces
//
// No batch-run logic, no predictive scoring.
// Pure multi-page crawl for any external domain.

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

/* ================================
   LOAD PAGES.JSON
   ================================ */

let presetPages = [];
try {
  const source = path.join(process.cwd(), "ontology", "pages.json");
  if (fs.existsSync(source)) {
    const raw = fs.readFileSync(source, "utf-8");
    presetPages = JSON.parse(raw);
  }
} catch (err) {
  console.warn("[audit] Failed to load pages.json", err.message);
  presetPages = [];
}

/* ================================
   LOAD Constraint Explanations (optional)
   ================================ */
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

/* ================================
   LOAD Constraint Severity (optional)
   ================================ */
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

function getBaseOrigin(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.hostname.replace(/^www\./i, "")}`;
  } catch {
    return null;
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

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
   ONTOLOGY Overlay Weighting
   ================================ */
function applyOntologyOverlay(baseScore, alignment) {
  if (alignment == null || Number.isNaN(alignment)) return baseScore;
  const a = clamp(alignment, 0, 1);
  return clamp(Math.round(baseScore * 0.85 + a * 15), 0, 100);
}

/* ================================
   ONTOLOGY Severity Summary
   ================================ */
const SEVERITY_ORDER = ["critical", "high", "medium", "low", "unknown"];

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
      (id && constraintSeverity[id]) ||
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
   SINGLE-PAGE AUDIT
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
      raw: tierRaw.tier1,
      maxWeight: tierMax.tier1,
      normalized:
        tierMax.tier1 > 0 ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2)) : 0,
    },
    tier2: {
      raw: tierRaw.tier2,
      maxWeight: tierMax.tier2,
      normalized:
        tierMax.tier2 > 0 ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2)) : 0,
    },
    tier3: {
      raw: tierRaw.tier3,
      maxWeight: tierMax.tier3,
      normalized:
        tierMax.tier3 > 0 ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2)) : 0,
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

  if (!Array.isArray(ontologyReport.failedConstraints)) {
    ontologyReport.failedConstraints = [];
  }

  for (const fc of ontologyReport.failedConstraints) {
    const exp = constraintExplanations?.[fc.id];
    if (exp && typeof fc.explanation === "undefined") {
      fc.explanation = exp;
    }
  }

  const ontologySeverity = summarizeOntologySeverity(ontologyReport);

  /* ---------- Overlay ---------- */
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
    pageLinks,
  };
}

/* ================================
   MULTI-PAGE LOGIC
   ================================ */
function deriveBaseUrl(requestedUrl) {
  try {
    const u = new URL(requestedUrl);
    return `${u.protocol}//${u.hostname.replace(/^www\./i, "")}`;
  } catch {
    return null;
  }
}

function buildSurfaceUrls(baseUrl) {
  if (!baseUrl || !Array.isArray(presetPages)) return [];

  const results = [];
  for (const p of presetPages) {
    const path = (p.path || "").trim();
    if (!path) continue;

    let full;
    try {
      full = new URL(path, baseUrl).toString();
    } catch {
      continue;
    }

    results.push(full);
  }

  return results;
}

/* ================================
   MAIN API HANDLER
   ================================ */
export default async function handler(req, res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    req.headers.origin || "*"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const input = req.query?.url;
    if (!input) return res.status(400).json({ error: "Missing URL" });

    const mode = req.query?.mode === "static" ? "static" : "rendered";

    /* ---------- Primary Audit ---------- */
    const primaryAudit = await runSingleAudit({
      url: input,
      mode,
    });

    /* ---------- Multi-Page Branch ---------- */
    const baseUrl = deriveBaseUrl(primaryAudit.url);
    const surfaceList = buildSurfaceUrls(baseUrl);

    const secondaryAudits = [];

    for (const url of surfaceList) {
      if (url === primaryAudit.url) continue;
      try {
        const a = await runSingleAudit({ url, mode });
        secondaryAudits.push(a);
      } catch (err) {
        console.warn("[audit] Failed surface:", url, err.message);
      }
    }

    const allAudits = [primaryAudit, ...secondaryAudits];

    const unified = resolveEntitySurfaces({
      audits: allAudits,
      tolerance: 0.65,
    });

    /* ---------- Response ---------- */
    return res.status(200).json({
      success: true,
      requestedUrl: input,
      baseUrl,
      mode,
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
