// /api/audit.js — EEI v5.6.1 Phase-5 MULTI-PAGE Crawl (Unified Diagnostics Restored)

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
} catch {
  presetPages = [];
}

/* ================================
   LOAD Constraint Descriptors
   ================================ */
let constraintExplanations = {};
try {
  const p = path.join(process.cwd(), "ontology", "constraintExplanations.json");
  if (fs.existsSync(p)) {
    constraintExplanations = JSON.parse(fs.readFileSync(p, "utf-8"));
  }
} catch {}

let constraintSeverity = {};
try {
  const p = path.join(process.cwd(), "ontology", "constraintSeverity.json");
  if (fs.existsSync(p)) {
    constraintSeverity = JSON.parse(fs.readFileSync(p, "utf-8"));
  }
} catch {}

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

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "unknown"];

function applyOntologyOverlay(baseScore, alignment) {
  if (alignment == null || Number.isNaN(alignment)) return baseScore;
  const a = clamp(alignment, 0, 1);
  return clamp(Math.round(baseScore * 0.85 + a * 15), 0, 100);
}

function summarizeOntologySeverity(ontology) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };

  if (!ontology) return { counts, topSeverity: null };

  if (ontology.severitySummary?.counts) {
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
    const mapped =
      (fc?.id && constraintSeverity[fc.id]) ||
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

/* ==========================================================
   SINGLE-SURFACE AUDIT
   ========================================================== */
async function runSingleAudit({ url, mode }) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error("Invalid URL format");

  const host = hostnameOf(normalized);
  const crawl = await crawlPage({ url: normalized, mode });

  if (crawl.error || !crawl.html) {
    const err = new Error(crawl.error || "Failed to crawl URL");
    err.httpStatus = crawl.status || 500;
    err.crawl = crawl;
    throw err;
  }

  const {
    html,
    title: crawlTitle,
    description: crawlDesc,
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
    crawlDesc ||
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
    (title.includes(" | ") ? title.split(" | ")[0] : title.split(" - ")[0]) ||
    "";

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

  const tierScores = {
    tier1: {
      raw: tierRaw.tier1,
      maxWeight: tierMax.tier1,
      normalized:
        tierMax.tier1 > 0
          ? Number(((tierRaw.tier1 / tierMax.tier1) * 100).toFixed(2))
          : 0,
    },
    tier2: {
      raw: tierRaw.tier2,
      maxWeight: tierMax.tier2,
      normalized:
        tierMax.tier2 > 0
          ? Number(((tierRaw.tier2 / tierMax.tier2) * 100).toFixed(2))
          : 0,
    },
    tier3: {
      raw: tierRaw.tier3,
      maxWeight: tierMax.tier3,
      normalized:
        tierMax.tier3 > 0
          ? Number(((tierRaw.tier3 / tierMax.tier3) * 100).toFixed(2))
          : 0,
    },
  };

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

  const entityScoreOntologyAdjusted = applyOntologyOverlay(
    entityScoreBase,
    ontologyReport.alignmentScore
  );

  const entityScore = entityScoreOntologyAdjusted;
  const entityTier = tierFromScore(entityScore);

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

/* ==========================================================
   MERGE CRAWL HEALTH FROM SURFACES
   ========================================================== */
function mergeCrawlHealth(audits) {
  const merged = {
    score: null,
    diagnostics: [],
    crawlerAccess: null,
    sitemapFound: null,
    canonicalResolved: null,
    surfaceIndexable: null,
    internalLinkDensity: null,
  };

  let best = null;

  for (const s of audits) {
    if (!s?.crawlHealth) continue;

    if (s.crawlHealth?.score != null) {
      if (!best || s.crawlHealth.score > best.score) {
        best = s.crawlHealth;
      }
    }

    if (Array.isArray(s.crawlHealth?.diagnostics)) {
      merged.diagnostics = merged.diagnostics.concat(
        s.crawlHealth.diagnostics
      );
    }
  }

  if (best) {
    merged.score = best.score ?? null;
    merged.crawlerAccess = best.crawlerAccess ?? null;
    merged.sitemapFound = best.sitemapFound ?? null;
    merged.canonicalResolved = best.canonicalResolved ?? null;
    merged.surfaceIndexable = best.surfaceIndexable ?? null;
    merged.internalLinkDensity = best.internalLinkDensity ?? null;
  }

  return merged;
}

/* ==========================================================
   MULTI-SURFACE LOGIC
   ========================================================== */
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
    const seg = (p.path || "").trim();
    if (!seg) continue;
    try {
      results.push(new URL(seg, baseUrl).toString());
    } catch {}
  }
  return results;
}

/* ==========================================================
   MAIN HANDLER — Unified Diagnostics Restored
   ========================================================== */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const input = req.query?.url;
    if (!input) return res.status(400).json({ error: "Missing URL" });

    const mode = req.query?.mode === "static" ? "static" : "rendered";

    const primary = await runSingleAudit({ url: input, mode });

    const baseUrl = deriveBaseUrl(primary.url);
    const targets = buildSurfaceUrls(baseUrl);

    const secondaries = [];
    for (const u of targets) {
      if (u === primary.url) continue;
      try {
        secondaries.push(await runSingleAudit({ url: u, mode }));
      } catch (err) {
        console.warn("[audit] surface fail:", u, err.message);
      }
    }

    const surfaces = [primary, ...secondaries];

    const unifiedRaw = resolveEntitySurfaces({
      audits: surfaces,
      tolerance: 0.65,
    });

    // restore unified crawl health
    const unifiedCrawlHealth = mergeCrawlHealth(surfaces);

    let canonicalSurface = surfaces.find(
      (s) => s.url === unifiedRaw.primaryUrl
    );

    if (!canonicalSurface) {
      canonicalSurface = primary;
    }

    const {
      tierScores,
      breakdown,
      scoringBars,
      entityName,
    } = canonicalSurface;

    const unified = {
      ...unifiedRaw,
      tierScores,
      breakdown,
      scoringBars,
      entityName,
      crawlHealth: unifiedCrawlHealth,
    };

    return res.status(200).json({
      success: true,
      requestedUrl: input,
      baseUrl,
      mode,
      surfaces,
      unified,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(err.httpStatus || 500).json({
      success: false,
      error: err.message || "Internal Error",
      crawl: err.crawl || null,
    });
  }
}
