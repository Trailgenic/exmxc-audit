// =====================================================
// scoring.js — V5.1 Calibrated Edition (Full File)
// exmxc.ai | Entity Engineering™
// Modular scoring engine used by audit.js + batch
// =====================================================

export function scoreAudit(data) {
  const signals = [];

  // -----------------------------
  // Tier 1 — Entity Comprehension & Trust (65 pts)
  // -----------------------------

  // Title Precision (3)
  signals.push({
    key: "Title Precision",
    max: 3,
    points: scoreTitle(data.title),
    raw: { title: data.title }
  });

  // Meta Description Integrity (3)
  signals.push({
    key: "Meta Description Integrity",
    max: 3,
    points: scoreMetaDescription(data.description),
    raw: { meta: data.description }
  });

  // Canonical Clarity (2)
  signals.push({
    key: "Canonical Clarity",
    max: 2,
    points: scoreCanonical(data.canonical),
    raw: { canonical: data.canonical }
  });

  // Schema Presence & Validity (10)
  signals.push({
    key: "Schema Presence & Validity",
    max: 10,
    points: scoreSchemaPresence(data.schemaMeta),
    raw: { schemaBlocks: data.schemaMeta.schemaBlocks }
  });

  // Organization Schema (8)
  signals.push({
    key: "Organization Schema",
    max: 8,
    points: scoreOrganizationSchema(data),
    raw: data.orgSchema || null
  });

  // Breadcrumb Schema (7)
  signals.push({
    key: "Breadcrumb Schema",
    max: 7,
    points: scoreBreadcrumbSchema(data),
    raw: data.breadcrumbSchema || null
  });

  // Author/Person Schema (5)
  signals.push({
    key: "Author/Person Schema",
    max: 5,
    points: scoreAuthorSchema(data),
    raw: { person: data.personSchema, metaAuthor: data.metaAuthor }
  });

  // Social Entity Links (5)
  signals.push({
    key: "Social Entity Links",
    max: 5,
    points: scoreSocialLinks(data),
    raw: { distinctSocialHosts: data.distinctSocialHosts || [] }
  });

  // AI Crawl Fidelity (10)
  signals.push({
    key: "AI Crawl Fidelity",
    max: 10,
    points: scoreAICrawl(data),
    raw: { robots: data.robots, aiPing: data.aiPing }
  });

  // -----------------------------
  // Tier 2 — Structural Data Fidelity (30 pts)
  // -----------------------------

  // Inference Efficiency (15)
  signals.push({
    key: "Inference Efficiency",
    max: 15,
    points: scoreInferenceEfficiency(data.wordCount),
    raw: { wordCount: data.wordCount }
  });

  // Internal Lattice Integrity (20)
  signals.push({
    key: "Internal Lattice Integrity",
    max: 20,
    points: scoreInternalLinks(data.internalLinkRatio),
    raw: {
      total: data.totalLinks,
      internal: data.internalLinks,
      ratio: data.internalLinkRatio
    }
  });

  // External Authority Signal (15)
  signals.push({
    key: "External Authority Signal",
    max: 15,
    points: scoreExternalAuthority(data),
    raw: {
      count: data.outboundCount,
      distinctOutboundHosts: data.distinctOutboundHosts
    }
  });

  // -----------------------------
  // Tier 3 — Page-Level Hygiene (10 pts)
  // -----------------------------

  // Brand & Technical Consistency (2)
  signals.push({
    key: "Brand & Technical Consistency",
    max: 2,
    points: scoreBrandConsistency(data),
    raw: { favicon: data.favicon, ogImage: data.ogImage }
  });

  // -----------------------------
  // Aggregate Scoring
  // -----------------------------

  const entityScore = signals.reduce((a, b) => a + b.points, 0);

  const tierScores = computeTierBreakdown(signals);

  const stage = computeEntityStage(entityScore);

  return {
    entityScore,
    entityStage: stage.stage,
    entityVerb: stage.verb,
    entityDescription: stage.description,
    entityFocus: stage.focus,
    signals,
    tierScores
  };
}

// =====================================================
// === SIGNAL SCORING FUNCTIONS ========================
// =====================================================

// Title Precision
function scoreTitle(title) {
  if (!title || title.trim().length < 5) return 0;
  if (title.length < 30) return 1;
  if (title.length < 60) return 2;
  return 3;
}

// Meta Description
function scoreMetaDescription(desc) {
  if (!desc) return 0;
  if (desc.length < 50) return 1;
  if (desc.length < 120) return 2;
  return 3;
}

// Canonical
function scoreCanonical(canonical) {
  if (!canonical) return 0;
  if (canonical.includes("http")) return 2;
  return 1;
}

// Schema Presence
function scoreSchemaPresence(schemaMeta) {
  const count = schemaMeta.schemaBlocks || 0;
  if (count === 0) return 0;
  if (count === 1) return 4;
  if (count <= 3) return 7;
  return 10;
}

// Org Schema
function scoreOrganizationSchema(data) {
  if (!data.orgSchema) return 0;
  const s = data.orgSchema;
  let points = 0;
  if (s.name) points += 3;
  if (s.url) points += 2;
  if (s.logo) points += 1;
  if (s.sameAs && s.sameAs.length > 0) points += 2;
  return Math.min(points, 8);
}

// Breadcrumb Schema
function scoreBreadcrumbSchema(data) {
  if (!data.breadcrumbSchema) return 0;
  return 7;
}

// Author Schema
function scoreAuthorSchema(data) {
  if (data.personSchema) return 5;
  if (data.metaAuthor) return 2;
  return 0;
}

// Social Links
function scoreSocialLinks(data) {
  const hosts = data.distinctSocialHosts || [];
  if (hosts.length >= 3) return 5;
  if (hosts.length >= 1) return 3;
  return 0;
}

// AI Crawl Fidelity
function scoreAICrawl(data) {
  let score = 0;
  if (data.robots && !data.robots.includes("noindex")) score += 4;
  if (data.aiPing === true) score += 6;
  return score;
}

// Inference Efficiency (word count)
function scoreInferenceEfficiency(words) {
  if (!words) return 0;
  if (words < 300) return 5;
  if (words < 1200) return 10;
  return 15;
}

// Internal Link Ratio
function scoreInternalLinks(ratio) {
  if (!ratio || ratio === 0) return 0;
  if (ratio < 0.2) return 5;
  if (ratio < 0.4) return 10;
  if (ratio < 0.6) return 15;
  return 20;
}

// External Authority
function scoreExternalAuthority(data) {
  const hosts = data.distinctOutboundHosts || [];
  if (hosts.length >= 5) return 15;
  if (hosts.length >= 2) return 10;
  if (hosts.length >= 1) return 5;
  return 0;
}

// Brand Consistency
function scoreBrandConsistency(data) {
  if (data.favicon && data.ogImage) return 2;
  if (data.favicon) return 1;
  return 0;
}

// =====================================================
// === TIER SYSTEM =====================================
// =====================================================

function computeTierBreakdown(signals) {
  // Tier 1: first 9 signals (max 65)
  const tier1 = signals.slice(0, 9);
  const tier1Raw = tier1.reduce((a, b) => a + b.points, 0);

  // Tier 2: next 3 signals (max 30)
  const tier2 = signals.slice(9, 12);
  const tier2Raw = tier2.reduce((a, b) => a + b.points, 0);

  // Tier 3: last signal (max 10 → we use 2 but normalize to 10)
  const tier3 = signals.slice(12);
  const tier3Raw = tier3.reduce((a, b) => a + b.points, 0);
  const tier3Norm = (tier3Raw / 2) * 10; // normalize 2 → 10 scale

  return {
    tier1: {
      label: "Entity comprehension & trust",
      raw: tier1Raw,
      maxWeight: 65,
      normalized: Math.round((tier1Raw / 65) * 100)
    },
    tier2: {
      label: "Structural data fidelity",
      raw: tier2Raw,
      maxWeight: 30,
      normalized: Math.round((tier2Raw / 30) * 100)
    },
    tier3: {
      label: "Page-level hygiene",
      raw: tier3Raw,
      maxWeight: 10,
      normalized: Math.round(tier3Norm)
    }
  };
}

// =====================================================
// === ENTITY STAGE LOGIC ==============================
// =====================================================

function computeEntityStage(score) {
  if (score >= 90) {
    return {
      stage: "☀️ Sovereign Entity",
      verb: "Amplify",
      description: "Dominant AI identity. Fully trusted.",
      focus: "Push advanced schema chaining, add knowledge panels."
    };
  }
  if (score >= 70) {
    return {
      stage: "🌕 Structured Entity",
      verb: "Strengthen",
      description: "Recognized with strong structure.",
      focus: "Increase schema depth, unify brand identity."
    };
  }
  if (score >= 40) {
    return {
      stage: "🌗 Visible Entity",
      verb: "Clarify",
      description: "Recognized but inconsistent. Schema present but incomplete.",
      focus: "Standardize structure, fix canonicals, and strengthen schema links."
    };
  }
  if (score >= 20) {
    return {
      stage: "🌑 Emergent Entity",
      verb: "Define",
      description: "Early-stage identity forming. Schema sparse; AI relies on guesses.",
      focus: "Clarify your signal. Add foundational meta + first JSON-LD."
    };
  }
  return {
    stage: "🫥 Undefined Entity",
    verb: "Establish",
    description: "AI cannot determine identity.",
    focus: "Add title, meta, canonical, and org schema."
  };
}

