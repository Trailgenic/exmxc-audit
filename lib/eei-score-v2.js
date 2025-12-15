// /shared/eei-score-v2.js
// EEI Entity Scoring Engine v2.1
// Surface-aware | Entity-first | AI-comprehension aligned
// No ontology. No crawl logic. Pure scoring.

const MAX_SCORE = 100;

/* ============================================================
   WEIGHTS (LOCKED — DO NOT TUNE CASUALLY)
   ============================================================ */

const WEIGHTS = {
  TITLE: 3,
  META: 3,
  CANONICAL: 2,
  SCHEMA: 8,
  ORG_SCHEMA: 7,
  BREADCRUMB: 5,
  PERSON: 5,
  SOCIAL: 8,
  AI_FIDELITY: 6,
  INFERENCE: 12,
  INTERNAL_LATTICE: 15,
  EXTERNAL_AUTHORITY: 12,
  BRAND_CONSISTENCY: 2,

  // NEW (Tier-1 modifier, not additive inflation)
  ENTITY_SURFACE_COVERAGE: 8
};

/* ============================================================
   HELPERS
   ============================================================ */

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function percent(points, max) {
  return Math.round((points / max) * 100);
}

/* ============================================================
   SURFACE COVERAGE (NEW)
   ============================================================ */

function scoreSurfaceCoverage(surfaces = []) {
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    return {
      points: 0,
      notes: "Single-surface entity"
    };
  }

  let identitySurfaces = 0;
  let schemaSurfaces = 0;

  for (const s of surfaces) {
    if (!s?.diagnostics) continue;

    if (
      s.title ||
      s.description ||
      (s.schemaObjects && s.schemaObjects.length > 0)
    ) {
      identitySurfaces++;
    }

    if (s.schemaObjects && s.schemaObjects.length > 0) {
      schemaSurfaces++;
    }
  }

  const coverageRatio =
    surfaces.length > 0 ? identitySurfaces / surfaces.length : 0;

  let points = 0;
  let notes = "Sparse surface identity";

  if (coverageRatio >= 0.75) {
    points = WEIGHTS.ENTITY_SURFACE_COVERAGE;
    notes = "Strong multi-surface identity coherence";
  } else if (coverageRatio >= 0.4) {
    points = Math.round(WEIGHTS.ENTITY_SURFACE_COVERAGE * 0.6);
    notes = "Partial surface identity reinforcement";
  } else if (coverageRatio > 0) {
    points = Math.round(WEIGHTS.ENTITY_SURFACE_COVERAGE * 0.3);
    notes = "Weak surface identity";
  }

  return { points, notes };
}

/* ============================================================
   CORE SCORING
   ============================================================ */

export function scoreEntity({
  entity,
  surfaces = []
}) {
  const breakdown = [];
  let total = 0;

  /* ---------- TITLE ---------- */
  const titlePoints =
    entity?.title && entity.title.length > 15 ? WEIGHTS.TITLE : 0;
  breakdown.push({
    key: "Title Precision",
    points: titlePoints,
    max: WEIGHTS.TITLE,
    notes: titlePoints ? "Specific & contextual" : "Missing or weak"
  });
  total += titlePoints;

  /* ---------- META ---------- */
  const metaPoints =
    entity?.description && entity.description.length > 50
      ? WEIGHTS.META
      : 0;
  breakdown.push({
    key: "Meta Description Integrity",
    points: metaPoints,
    max: WEIGHTS.META,
    notes: metaPoints ? "Descriptive & complete" : "Missing"
  });
  total += metaPoints;

  /* ---------- CANONICAL ---------- */
  const canonicalPoints = entity?.canonical ? 1 : 0;
  breakdown.push({
    key: "Canonical Clarity",
    points: canonicalPoints,
    max: WEIGHTS.CANONICAL,
    notes: canonicalPoints ? "Present but inconsistent" : "Missing"
  });
  total += canonicalPoints;

  /* ---------- SCHEMA ---------- */
  const schemaCount = entity?.schemaObjects?.length || 0;
  const schemaPoints = schemaCount >= 3 ? WEIGHTS.SCHEMA : schemaCount > 0 ? 3 : 0;
  breakdown.push({
    key: "Schema Presence & Validity",
    points: schemaPoints,
    max: WEIGHTS.SCHEMA,
    notes:
      schemaCount >= 3
        ? "Multiple schema blocks"
        : schemaCount > 0
        ? "Limited schema"
        : "No JSON-LD found"
  });
  total += schemaPoints;

  /* ---------- ORG SCHEMA ---------- */
  const hasOrg =
    entity?.schemaObjects?.some((s) => s["@type"] === "Organization");
  breakdown.push({
    key: "Organization Schema",
    points: hasOrg ? WEIGHTS.ORG_SCHEMA : 0,
    max: WEIGHTS.ORG_SCHEMA,
    notes: hasOrg ? "Organization schema valid" : "Missing"
  });
  total += hasOrg ? WEIGHTS.ORG_SCHEMA : 0;

  /* ---------- BREADCRUMB ---------- */
  const hasBreadcrumb =
    entity?.schemaObjects?.some((s) => s["@type"] === "BreadcrumbList");
  breakdown.push({
    key: "Breadcrumb Schema",
    points: hasBreadcrumb ? WEIGHTS.BREADCRUMB : 0,
    max: WEIGHTS.BREADCRUMB,
    notes: hasBreadcrumb ? "Breadcrumb schema present" : "Missing"
  });
  total += hasBreadcrumb ? WEIGHTS.BREADCRUMB : 0;

  /* ---------- PERSON ---------- */
  const hasPerson =
    entity?.schemaObjects?.some((s) => s["@type"] === "Person");
  breakdown.push({
    key: "Author/Person Schema",
    points: hasPerson ? WEIGHTS.PERSON : 0,
    max: WEIGHTS.PERSON,
    notes: hasPerson ? "Person schema present" : "Missing"
  });
  total += hasPerson ? WEIGHTS.PERSON : 0;

  /* ---------- SOCIAL ---------- */
  const socialCount = entity?.socialHosts?.length || 0;
  const socialPoints =
    socialCount >= 3 ? WEIGHTS.SOCIAL : socialCount > 0 ? 4 : 0;
  breakdown.push({
    key: "Social Entity Links",
    points: socialPoints,
    max: WEIGHTS.SOCIAL,
    notes:
      socialCount >= 3
        ? "Strong (3+)"
        : socialCount > 0
        ? "Partial"
        : "None found"
  });
  total += socialPoints;

  /* ---------- AI FIDELITY ---------- */
  const aiPoints = entity?.aiPing ? WEIGHTS.AI_FIDELITY : 4;
  breakdown.push({
    key: "AI Crawl Fidelity",
    points: aiPoints,
    max: WEIGHTS.AI_FIDELITY,
    notes: entity?.aiPing ? "Explicit crawl ping" : "Indexable, no ping"
  });
  total += aiPoints;

  /* ---------- INFERENCE ---------- */
  const wc = entity?.wordCount || 0;
  const inferencePoints =
    wc >= 1200 ? WEIGHTS.INFERENCE : wc >= 400 ? 6 : 0;
  breakdown.push({
    key: "Inference Efficiency",
    points: inferencePoints,
    max: WEIGHTS.INFERENCE,
    notes:
      wc >= 1200 ? "Deep context" : wc >= 400 ? "Moderate" : "Shallow"
  });
  total += inferencePoints;

  /* ---------- INTERNAL LATTICE ---------- */
  const latticeRatio = entity?.internalLinkRatio || 0;
  const latticePoints =
    latticeRatio >= 0.7 ? WEIGHTS.INTERNAL_LATTICE : latticeRatio > 0 ? 6 : 0;
  breakdown.push({
    key: "Internal Lattice Integrity",
    points: latticePoints,
    max: WEIGHTS.INTERNAL_LATTICE,
    notes:
      latticeRatio >= 0.7
        ? "Strong lattice"
        : latticeRatio > 0
        ? "Some internal linking"
        : "No internal links"
  });
  total += latticePoints;

  /* ---------- EXTERNAL AUTHORITY ---------- */
  const outbound = entity?.externalHostCount || 0;
  const externalPoints = outbound >= 3 ? WEIGHTS.EXTERNAL_AUTHORITY : 0;
  breakdown.push({
    key: "External Authority Signal",
    points: externalPoints,
    max: WEIGHTS.EXTERNAL_AUTHORITY,
    notes:
      outbound >= 3 ? "Outbound credibility present" : "No outbound links"
  });
  total += externalPoints;

  /* ---------- BRAND ---------- */
  const brandPoints =
    entity?.favicon || entity?.ogImage ? WEIGHTS.BRAND_CONSISTENCY : 0;
  breakdown.push({
    key: "Brand & Technical Consistency",
    points: brandPoints,
    max: WEIGHTS.BRAND_CONSISTENCY,
    notes: brandPoints ? "Branding consistent" : "Missing"
  });
  total += brandPoints;

  /* ============================================================
     SURFACE COVERAGE MODIFIER (NEW)
     ============================================================ */

  const surfaceScore = scoreSurfaceCoverage(surfaces);
  breakdown.push({
    key: "Entity Surface Coverage",
    points: surfaceScore.points,
    max: WEIGHTS.ENTITY_SURFACE_COVERAGE,
    notes: surfaceScore.notes
  });

  // 🔒 modifier, not inflation
  const surfaceModifier =
    surfaceScore.points / WEIGHTS.ENTITY_SURFACE_COVERAGE || 0;

  const adjustedTotal = clamp(
    Math.round(total * (1 + surfaceModifier * 0.15)),
    0,
    MAX_SCORE
  );

  /* ============================================================
     RETURN
     ============================================================ */

  return {
    entityScore: adjustedTotal,
    breakdown,
    tierScores: {
      tier1: {
        label: "Entity comprehension & trust",
        normalized: clamp(Math.round((adjustedTotal / MAX_SCORE) * 100), 0, 100)
      }
    }
  };
}
