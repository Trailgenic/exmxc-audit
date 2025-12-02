// /api/audit.js — EEI v5.2 (Ontology Overlay + CrawlHealth + UX ScoringBars)
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

/* ================================
   HELPERS
   ================================ */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-audit/5.2 Safari/537.36";

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
   TIER MAPPING
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
   ONTOLOGY LOADER (v0.0 JSON Config)
   ================================ */

const ONTOLOGY_DIR = path.join(process.cwd(), "ontology");

let cachedOntologyConfig = null;

function loadOntologyConfig() {
  if (cachedOntologyConfig) return cachedOntologyConfig;

  const safeRead = (fileName, fallback) => {
    try {
      const full = path.join(ONTOLOGY_DIR, fileName);
      const raw = fs.readFileSync(full, "utf8");
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const version = safeRead("version.json", { id: "0.0", label: "local-default" });
  const domains = safeRead("domains.json", []);
  const signals = safeRead("signals.json", []);
  const relationships = safeRead("relationships.json", []);
  const constraints = safeRead("constraints.json", []);

  cachedOntologyConfig = {
    version,
    domains,
    signals,
    relationships,
    constraints,
  };

  return cachedOntologyConfig;
}

/* ================================
   ONTOLOGY ALIGNMENT ENGINE (v0.0)
   Overlay-only: does not alter signal internals.
   ================================ */

/**
 * Compute a lightweight ontology alignment score in [0,1].
 * Uses existing crawl + schema signals and a few hard rules.
 * Later, we can wire this directly into constraints.json.
 */
function evaluateOntologyAlignment({
  url,
  canonicalHref,
  schemaObjects,
  crawlHealth,
  results,
}) {
  const cfg = loadOntologyConfig();

  const failedConstraints = [];
  const contradictionFlags = [];
  const notes = [];

  let score = 1.0; // start fully aligned, subtract on violations

  const host = hostnameOf(url);
  let canonicalHost = host;

  try {
    const cUrl = new URL(canonicalHref || url);
    canonicalHost = cUrl.hostname.replace(/^www\./i, "");
  } catch {
    // ignore
  }

  const objs = Array.isArray(schemaObjects) ? schemaObjects : [];

  const hasOrgOrPerson = objs.some((o) => {
    const t = o["@type"];
    if (Array.isArray(t)) {
      return t.includes("Organization") || t.includes("Person");
    }
    return t === "Organization" || t === "Person";
  });

  // C1: Require Organization or Person schema on canonical surface
  if (!hasOrgOrPerson) {
    score -= 0.25;
    failedConstraints.push(
      "C1 – Missing Organization/Person schema on canonical surface."
    );
  }

  // C2: Canonical host must match request host
  if (host && canonicalHost && host !== canonicalHost) {
    score -= 0.15;
    failedConstraints.push(
      `C2 – Canonical host (${canonicalHost}) mismatches request host (${host}).`
    );
  }

  // Crawl-based structural signals
  const flags = crawlHealth?.flags || {};

  // C3: Schema sparse or missing JSON-LD
  if (flags.isSchemaSparse) {
    score -= 0.2;
    failedConstraints.push(
      "C3 – Crawl flagged schema-sparse or missing JSON-LD on canonical surface."
    );
  }

  // C4: Heavily JS-driven = harder interpretability
  if (flags.isJsHeavy) {
    score -= 0.1;
    failedConstraints.push(
      "C4 – Heavy JavaScript footprint on canonical surface (JS-heavy)."
    );
  }

  // C5: Thin content
  if (flags.isThinContent) {
    score -= 0.1;
    failedConstraints.push(
      "C5 – Thin content on canonical surface (low text depth)."
    );
  }

  // C6: Canonical signal itself thinks something is off
  const canonicalSignal = Array.isArray(results)
    ? results.find((r) => r.key === "Canonical Clarity")
    : null;

  if (canonicalSignal && canonicalSignal.max > 0) {
    const pct = canonicalSignal.points / canonicalSignal.max;
    if (pct < 0.5) {
      score -= 0.1;
      failedConstraints.push(
        "C6 – Canonical signal indicates weak or conflicting canonical roots."
      );
    }
  }

  score = clamp(score, 0, 1);

  if (score === 1) {
    notes.push("All v0.0 ontology checks passed.");
  } else {
    notes.push("One or more v0.0 ontology checks failed; see failedConstraints.");
  }

  return {
    version: cfg?.version?.id || cfg?.version?.version || "0.0",
    alignment: score,
    failedConstraints,
    contradictionFlags,
    notes,
  };
}

/**
 * Apply ontology overlay:
 * - 90% weight on base EEI score
 * - up to +10 points from ontology alignment
 */
function applyOntologyOverlay(baseScore, alignment) {
  if (alignment == null || Number.isNaN(alignment)) return baseScore;
  const a = clamp(alignment, 0, 1);
  const basePortion = baseScore * 0.9;
  const overlay = a * 10; // 0–10
  const finalScore = Math.round(basePortion + overlay);
  return clamp(finalScore, 0, 100);
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

  /* ---------- Input ---------- */
  try {
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
      // UA rotation handled inside core-scan now
      // userAgent: UA,
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
      crawlHealth: crawlHealthRaw,
      diagnostics: crawlDiagnostics,
    } = crawl;

    const $ = cheerio.load(html);

    /* ---------- Extract Fields ---------- */
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

    /* ---------- Entity Name ---------- */
    let entityName =
      schemaObjects.find((o) => o["@type"] === "Organization")?.name ||
      schemaObjects.find((o) => o["@type"] === "Person")?.name ||
      (title.includes(" | ") ? title.split(" | ")[0] : title.split(" - ")[0]) ||
      "";

    /* ---------- 13 Scoring Signals ---------- */
    const results = [
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

    /* ---------- Aggregate Base EEI Score ---------- */
    let totalRaw = 0;
    const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
    const tierMax = { tier1: 0, tier2: 0, tier3: 0 };

    for (const sig of results) {
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

    /* ---------- Tier Output (based on base weights) ---------- */
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

    /* ---------- Ontology Alignment + Overlay (Phase 1) ---------- */
    const ontologyEval = evaluateOntologyAlignment({
      url: normalized,
      canonicalHref,
      schemaObjects,
      crawlHealth: crawlHealthRaw,
      results,
    });

    const entityScoreOntologyAdjusted = applyOntologyOverlay(
      entityScoreBase,
      ontologyEval.alignment
    );

    // For UI compatibility: primary "entityScore" is now ontology-adjusted
    const entityScore = entityScoreOntologyAdjusted;
    const entityTier = tierFromScore(entityScore);

    /* ---------- Prep results for UX scoring bars ---------- */
    const scoringBars = results.map((r) => ({
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

      // Scores
      entityScoreBase, // pure 13-signal EEI
      entityScoreOntologyAdjusted, // explicit ontology-adjusted
      entityScore, // primary score used by UI (same as adjusted)

      entityStage: entityTier.stage,
      entityVerb: entityTier.verb,
      entityDescription: entityTier.description,
      entityFocus: entityTier.coreFocus,

      breakdown: results,
      scoringBars,
      tierScores,

      schemaMeta: {
        schemaBlocks: schemaObjects.length,
        latestISO,
        mode: resolvedMode,
        httpStatus,
      },

      // Crawl health
      crawlHealth: crawlHealthRaw || crawlDiagnostics || null,

      // Ontology overlay metadata
      ontology: {
        version: ontologyEval.version,
        alignment: ontologyEval.alignment,
        failedConstraints: ontologyEval.failedConstraints,
        contradictionFlags: ontologyEval.contradictionFlags,
        notes: ontologyEval.notes,
      },

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
