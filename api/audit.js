// /api/audit.js — EEI v5.4 Phase 4 Surface Mapping + Ontology Explanations + Safety Guard

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
import { mapSurfaceVectors } from "../lib/surfaceMapping.js";   // <-- NEW

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
   MAIN HANDLER
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

    const normalized = normalizeUrl(input);
    if (!normalized)
      return res.status(400).json({ error: "Invalid URL format" });

    const host = hostnameOf(normalized);
    const requestedMode = req.query?.mode === "static" ? "static" : "rendered";

    /* ---------- Crawl ---------- */
    const crawl = await crawlPage({
      url: normalized,
      mode: requestedMode,
    });

    if (crawl.error || !crawl.html) {
      return res.status(crawl.status || 500).json({
        success: false,
        error: crawl.error || "Failed to crawl URL",
        url: normalized,
        mode: crawl.mode,
        diagnostics: crawl.crawlHealth || null,
      });
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
       ONTOLOGY ENGINE (Phase 4)
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
      const expText = constraintExplanations?.[fc.id];
      if (expText && typeof expText === "string") {
        fc.explanation = expText;
      }
    }

    /* ================================
       SURFACE MAPPING (Phase 4)
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

    /* ---------- Response ---------- */
    return res.status(200).json({
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
      surface: surfaceVectors, // <-- NEW

      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
}
