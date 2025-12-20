/**
 * audit.js
 * EEI → ECI scoring pipeline (FIXED)
 * ----------------------------------
 * - Crawl → Signal scoring → EEI breakdown → ECI interpretation
 * - No silent failures
 * - Deterministic scoring
 */

export function runAudit(crawl) {
  const eei = buildEEI(crawl);
  const eci = buildECI(eei);

  return {
    success: true,
    eci,
    eei
  };
}

/* ============================================================
 * EEI SCORING LAYER
 * ============================================================ */

function buildEEI(crawl) {
  const breakdown = [];

  // Helper
  const add = (key, label, passed) => {
    breakdown.push({
      key,
      label,
      points: passed ? 1 : 0,
      max: 1,
      status: passed ? "Present" : "Missing"
    });
  };

  /* -------- 1. Title Precision -------- */
  add(
    "title_precision",
    "Title Precision",
    Boolean(crawl.title && crawl.title.length >= 15)
  );

  /* -------- 2. Meta Description Integrity -------- */
  add(
    "meta_description",
    "Meta Description Integrity",
    Boolean(crawl.description && crawl.description.length >= 50)
  );

  /* -------- 3. Canonical Clarity -------- */
  add(
    "canonical",
    "Canonical Clarity",
    Boolean(crawl.canonicalHref && crawl.canonicalHref.startsWith("https://"))
  );

  /* -------- 4. Schema Presence -------- */
  add(
    "schema_presence",
    "Schema Presence & Validity",
    Array.isArray(crawl.schemaObjects) && crawl.schemaObjects.length > 0
  );

  /* -------- 5. Organization Schema -------- */
  add(
    "org_schema",
    "Organization Schema",
    hasSchemaType(crawl.schemaObjects, "Organization")
  );

  /* -------- 6. Breadcrumb Schema -------- */
  add(
    "breadcrumb_schema",
    "Breadcrumb Schema",
    hasSchemaType(crawl.schemaObjects, "BreadcrumbList")
  );

  /* -------- 7. Author / Person Schema -------- */
  add(
    "person_schema",
    "Author / Person Schema",
    hasSchemaType(crawl.schemaObjects, "Person")
  );

  /* -------- 8. Social Entity Links -------- */
  add(
    "social_links",
    "Social Entity Links",
    hasSocialLinks(crawl.schemaObjects)
  );

  /* -------- 9. AI Crawl Fidelity -------- */
  add(
    "ai_crawl_fidelity",
    "AI Crawl Fidelity",
    crawl.status === 200
  );

  /* -------- 10. Inference Efficiency -------- */
  add(
    "inference_efficiency",
    "Inference Efficiency",
    crawl.wordCount && crawl.wordCount >= 500
  );

  /* -------- 11. Internal Lattice Integrity -------- */
  add(
    "internal_lattice",
    "Internal Lattice Integrity",
    Array.isArray(crawl.pageLinks) && crawl.pageLinks.length >= 10
  );

  /* -------- 12. External Authority Signal -------- */
  add(
    "external_authority",
    "External Authority Signal",
    hasExternalSameAs(crawl.schemaObjects)
  );

  /* -------- 13. Brand & Technical Consistency -------- */
  add(
    "brand_consistency",
    "Brand & Technical Consistency",
    Boolean(crawl.title && crawl.description)
  );

  return {
    url: crawl.url,
    hostname: crawl.hostname,
    breakdown,
    crawlHealth: {
      wordCount: crawl.wordCount || 0,
      linkCount: crawl.linkCount || 0,
      schemaCount: crawl.schemaObjects?.length || 0,
      jsonLdErrorCount: crawl.jsonLdErrorCount || 0
    },
    timestamp: new Date().toISOString()
  };
}

/* ============================================================
 * ECI INTERPRETATION LAYER
 * ============================================================ */

function buildECI(eei) {
  const breakdown = eei.breakdown || [];

  let observed = 0;
  let totalPoints = 0;
  let maxPoints = 0;

  breakdown.forEach(sig => {
    maxPoints += sig.max;
    if (sig.status !== "Missing") {
      observed += 1;
      totalPoints += sig.points;
    }
  });

  const score = maxPoints > 0
    ? Math.round((totalPoints / maxPoints) * 100)
    : 0;

  return {
    entity: {
      name: eei.hostname,
      url: eei.url,
      hostname: eei.hostname,
      timestamp: eei.timestamp
    },
    eci: {
      score,
      range: scoreRange(score),
      interpretation: interpretation(score),
      strategicPosture: posture(score),
      signalCoverage: {
        observed,
        unknown: 13 - observed
      },
      claritySignals: breakdown.map(b => ({
        name: b.label,
        status: b.status
      }))
    }
  };
}

/* ============================================================
 * HELPERS
 * ============================================================ */

function hasSchemaType(objects = [], type) {
  return objects.some(o => o["@type"] === type);
}

function hasSocialLinks(objects = []) {
  return objects.some(o =>
    Array.isArray(o.sameAs) && o.sameAs.length > 0
  );
}

function hasExternalSameAs(objects = []) {
  return objects.some(o =>
    Array.isArray(o.sameAs) &&
    o.sameAs.some(url => !url.includes("instagram.com") && !url.includes("threads.net"))
  );
}

function scoreRange(score) {
  if (score >= 80) return "80–100";
  if (score >= 60) return "60–79";
  if (score >= 40) return "40–59";
  return "0–39";
}

function interpretation(score) {
  if (score >= 80) return "High clarity";
  if (score >= 60) return "Operational clarity";
  if (score >= 40) return "Partial clarity";
  return "Low clarity";
}

function posture(score) {
  if (score >= 80) return "Defensible";
  if (score >= 60) return "Structured";
  if (score >= 40) return "Emerging";
  return "Unformed";
}
