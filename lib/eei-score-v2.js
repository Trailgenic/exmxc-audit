// eei-score-v2.js — Entity Engineering Index Scorer (Surface-Aware)
// Works with core-scan v2.7+
// Supports single-page OR multi-surface crawls
// Deterministic, AI-comprehension aligned

/* ============================================================
   CONFIG
   ============================================================ */

const MAX_SCORE = 100;

const SIGNAL_WEIGHTS = {
  title: 3,
  meta: 3,
  canonical: 2,
  schema: 8,
  orgSchema: 7,
  breadcrumb: 5,
  author: 5,
  social: 8,
  aiFidelity: 6,
  inference: 12,
  lattice: 15,
  external: 12,
  brand: 2
};

const SURFACE_WEIGHT = 0.35; // how much surfaces influence total score

/* ============================================================
   HELPERS
   ============================================================ */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pct(points, max) {
  return Math.round((points / max) * 100);
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function hasSchemaType(objs, type) {
  return objs.some(o => o?.["@type"] === type);
}

/* ============================================================
   SURFACE AGGREGATION
   ============================================================ */

function aggregateSurfaces(surfaces = []) {
  const agg = {
    wordCount: 0,
    schemaCount: 0,
    internalLinks: 0,
    totalLinks: 0,
    hasOrgSchema: false,
    hasBreadcrumb: false,
    hasAuthor: false
  };

  for (const s of surfaces) {
    const d = s.diagnostics || {};
    agg.wordCount += d.wordCount || 0;
    agg.internalLinks += d.internalLinkCount || 0;
    agg.totalLinks += d.linkCount || 0;

    const schema = safeArray(s.schemaObjects);
    agg.schemaCount += schema.length;
    if (hasSchemaType(schema, "Organization")) agg.hasOrgSchema = true;
    if (hasSchemaType(schema, "BreadcrumbList")) agg.hasBreadcrumb = true;
    if (hasSchemaType(schema, "Person")) agg.hasAuthor = true;
  }

  return agg;
}

/* ============================================================
   CORE SCORING
   ============================================================ */

function scoreEntity({ entity, surfaces = [] }) {
  const breakdown = [];
  let total = 0;

  const d = entity.diagnostics || {};
  const schemaObjects = safeArray(entity.schemaObjects);
  const surfaceAgg = aggregateSurfaces(surfaces);

  /* ---------- Title ---------- */
  let titlePts = entity.title?.length > 20 ? 3 : entity.title ? 1 : 0;
  total += titlePts;
  breakdown.push({
    key: "Title Precision",
    points: titlePts,
    max: SIGNAL_WEIGHTS.title,
    notes: titlePts === 3 ? "Specific & contextual" : titlePts ? "Weak" : "Missing",
    raw: { title: entity.title || "" }
  });

  /* ---------- Meta ---------- */
  let metaPts = entity.description?.length > 50 ? 3 : entity.description ? 1 : 0;
  total += metaPts;
  breakdown.push({
    key: "Meta Description Integrity",
    points: metaPts,
    max: SIGNAL_WEIGHTS.meta,
    notes: metaPts === 3 ? "Descriptive & complete" : metaPts ? "Thin" : "Missing",
    raw: { meta: entity.description || "" }
  });

  /* ---------- Canonical ---------- */
  let canonPts = entity.canonicalHref ? 1 : 0;
  total += canonPts;
  breakdown.push({
    key: "Canonical Clarity",
    points: canonPts,
    max: SIGNAL_WEIGHTS.canonical,
    notes: canonPts ? "Present but inconsistent" : "Missing",
    raw: { canonical: entity.canonicalHref || "" }
  });

  /* ---------- Schema Presence ---------- */
  let schemaPts = clamp(schemaObjects.length, 0, 8);
  total += schemaPts;
  breakdown.push({
    key: "Schema Presence & Validity",
    points: schemaPts,
    max: SIGNAL_WEIGHTS.schema,
    notes: schemaPts > 3 ? "Multiple schema blocks" : schemaPts ? "Minimal" : "None",
    raw: { schemaBlocks: schemaObjects.length }
  });

  /* ---------- Organization Schema (surface-aware) ---------- */
  let orgPts = surfaceAgg.hasOrgSchema ? 7 : 0;
  total += orgPts;
  breakdown.push({
    key: "Organization Schema",
    points: orgPts,
    max: SIGNAL_WEIGHTS.orgSchema,
    notes: orgPts ? "Organization schema valid" : "Missing",
    raw: null
  });

  /* ---------- Breadcrumb ---------- */
  let bcPts = surfaceAgg.hasBreadcrumb ? 5 : 0;
  total += bcPts;
  breakdown.push({
    key: "Breadcrumb Schema",
    points: bcPts,
    max: SIGNAL_WEIGHTS.breadcrumb,
    notes: bcPts ? "Breadcrumb schema present" : "Missing",
    raw: null
  });

  /* ---------- Author ---------- */
  let authorPts = surfaceAgg.hasAuthor ? 5 : 0;
  total += authorPts;
  breakdown.push({
    key: "Author/Person Schema",
    points: authorPts,
    max: SIGNAL_WEIGHTS.author,
    notes: authorPts ? "Person schema present" : "Missing",
    raw: { person: !!authorPts }
  });

  /* ---------- Social ---------- */
  const socialCount = safeArray(entity.socialHosts).length;
  let socialPts = socialCount >= 3 ? 8 : socialCount ? 4 : 0;
  total += socialPts;
  breakdown.push({
    key: "Social Entity Links",
    points: socialPts,
    max: SIGNAL_WEIGHTS.social,
    notes: socialPts === 8 ? "Strong (3+)" : socialPts ? "Weak" : "None",
    raw: { distinctSocialHosts: entity.socialHosts || [] }
  });

  /* ---------- AI Fidelity ---------- */
  let aiPts = entity.aiPing ? 6 : 4;
  total += aiPts;
  breakdown.push({
    key: "AI Crawl Fidelity",
    points: aiPts,
    max: SIGNAL_WEIGHTS.aiFidelity,
    notes: entity.aiPing ? "Explicit crawl ping" : "Indexable, no ping",
    raw: { aiPing: !!entity.aiPing }
  });

  /* ---------- Inference (surface weighted) ---------- */
  const inferredWords =
    d.wordCount + surfaceAgg.wordCount * SURFACE_WEIGHT;
  let infPts =
    inferredWords > 1500 ? 12 :
    inferredWords > 600 ? 6 : 0;

  total += infPts;
  breakdown.push({
    key: "Inference Efficiency",
    points: infPts,
    max: SIGNAL_WEIGHTS.inference,
    notes: infPts === 12 ? "Deep context" : infPts ? "Moderate" : "Shallow",
    raw: { wordCount: Math.round(inferredWords) }
  });

  /* ---------- Internal Lattice ---------- */
  const latticeRatio =
    surfaceAgg.totalLinks > 0
      ? surfaceAgg.internalLinks / surfaceAgg.totalLinks
      : 0;

  let latticePts =
    latticeRatio > 0.5 ? 15 :
    latticeRatio > 0.25 ? 8 : 0;

  total += latticePts;
  breakdown.push({
    key: "Internal Lattice Integrity",
    points: latticePts,
    max: SIGNAL_WEIGHTS.lattice,
    notes: latticePts === 15 ? "Strong lattice" : latticePts ? "Partial" : "None",
    raw: {
      internal: surfaceAgg.internalLinks,
      total: surfaceAgg.totalLinks,
      ratio: latticeRatio
    }
  });

  /* ---------- External ---------- */
  let extPts = entity.externalLinks?.length ? 12 : 0;
  total += extPts;
  breakdown.push({
    key: "External Authority Signal",
    points: extPts,
    max: SIGNAL_WEIGHTS.external,
    notes: extPts ? "Outbound credibility present" : "No outbound links",
    raw: { distinctOutboundHosts: entity.externalLinks || [] }
  });

  /* ---------- Brand ---------- */
  let brandPts = entity.favicon || entity.ogImage ? 2 : 0;
  total += brandPts;
  breakdown.push({
    key: "Brand & Technical Consistency",
    points: brandPts,
    max: SIGNAL_WEIGHTS.brand,
    notes: brandPts ? "Branding consistent" : "Missing",
    raw: { favicon: entity.favicon || "", ogImage: entity.ogImage || "" }
  });

  /* ============================================================
     FINAL
     ============================================================ */

  const entityScore = clamp(Math.round((total / MAX_SCORE) * 100), 0, 100);

  return {
    entityScore,
    breakdown,
    tierScores: {
      tier1: { label: "Entity comprehension & trust", normalized: entityScore },
      tier2: { label: "Structural data fidelity", normalized: clamp(schemaPts * 12.5, 0, 100) },
      tier3: { label: "Page-level hygiene", normalized: clamp((titlePts + metaPts + brandPts) * 10, 0, 100) }
    }
  };
}

export default scoreEntity;
