// /lib/surfaceResolver.js — EEI v5.4 Phase 4.4 Multi-Surface Resolver
//
// Input: array of single-surface audit results (shaped like /api/audit response)
//   resolveEntitySurfaces({ audits, tolerance })
//
// Output: unified multi-surface entity verdict:
//   {
//     primaryRoot,
//     primaryUrl,
//     surfaces,
//     perimeterConfidence,
//     unifiedAlignmentScore,
//     identityUnificationScore,
//     severityRollup,
//     entityScore,
//     entityStage,
//     entityVerb,
//     entityDescription,
//     entityFocus,
//   }

import { tierFromScore } from "../shared/scoring.js";

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function normalizeHost(host) {
  if (!host) return null;
  return String(host).toLowerCase().replace(/^www\./i, "");
}

// Very light registrable root: last 2 labels
function getRootDomain(host) {
  if (!host) return null;
  const parts = String(host).split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

// Simple name → token normalizer for org/entity names
function normalizeNameToken(name) {
  if (!name || typeof name !== "string") return null;
  let s = name.toLowerCase();

  // Strip ™ / ®
  s = s.replace(/™|®/g, "");
  // Strip generic company suffixes
  s = s.replace(/\b(inc\.?|llc|corp\.?|corporation|company|co\.?)\b/g, "");
  // Collapse non-alphanumeric into dashes
  s = s.replace(/[^a-z0-9]+/g, "-");
  // Trim dashes
  s = s.replace(/^-+|-+$/g, "");

  return s || null;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "unknown"];

function severityRank(level) {
  const idx = SEVERITY_ORDER.indexOf(level || "unknown");
  return idx === -1 ? SEVERITY_ORDER.length - 1 : idx;
}

/**
 * Compute an identity similarity score between two surfaces (0–1)
 * based on canonical root, identity root, org schema name, and entity token.
 */
function computeIdentitySimilarity(a, b) {
  if (!a || !b) return 0;

  let score = 0;
  let weight = 0;

  // Root domains
  if (a.canonicalRoot && b.canonicalRoot) {
    weight += 0.4;
    if (a.canonicalRoot === b.canonicalRoot) score += 0.4;
  }

  if (a.identityRoot && b.identityRoot) {
    weight += 0.3;
    if (a.identityRoot === b.identityRoot) score += 0.3;
  }

  // Org schema names
  if (a.orgToken && b.orgToken) {
    weight += 0.2;
    if (a.orgToken === b.orgToken) score += 0.2;
  }

  // Entity name tokens
  if (a.entityToken && b.entityToken) {
    weight += 0.1;
    if (a.entityToken === b.entityToken) score += 0.1;
  }

  if (weight === 0) return 0;
  return score / weight; // already 0–1 by construction
}

/**
 * Extract a compact identity vector from a single-surface audit.
 */
function extractIdentityVector(audit) {
  const ontologyIdentity = audit?.ontology?.identity || {};
  const hostname = normalizeHost(audit?.hostname);
  const canonicalRoot =
    ontologyIdentity.canonicalRoot || getRootDomain(hostname) || null;
  const identityRoot =
    ontologyIdentity.identityRoot || canonicalRoot || null;

  const orgSchemaName = ontologyIdentity.orgSchemaName || null;
  const entityName = audit?.entityName || ontologyIdentity.entityName || null;

  const orgToken = normalizeNameToken(orgSchemaName);
  const entityToken = normalizeNameToken(entityName);

  return {
    canonicalRoot,
    identityRoot,
    orgToken,
    entityToken,
  };
}

/**
 * Roll up severities across multiple audits
 */
function rollupSeverities(audits) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };

  for (const a of audits) {
    const sevSummary =
      a?.ontologySeverity ||
      a?.ontology?.severitySummary ||
      null;

    if (sevSummary?.counts) {
      for (const level of Object.keys(counts)) {
        if (typeof sevSummary.counts[level] === "number") {
          counts[level] += sevSummary.counts[level];
        }
      }
      continue;
    }

    // Fallback: if there is no summary but failedConstraints exist
    const failed = a?.ontology?.failedConstraints || [];
    if (Array.isArray(failed) && failed.length > 0) {
      for (const fc of failed) {
        const level =
          fc?.explanation?.severity ||
          fc?.severity ||
          "unknown";
        const key = SEVERITY_ORDER.includes(level) ? level : "unknown";
        counts[key] += 1;
      }
    }
  }

  // Determine top severity
  let topSeverity = null;
  for (const level of SEVERITY_ORDER) {
    if (counts[level] > 0) {
      topSeverity = level;
      break;
    }
  }

  return { counts, topSeverity };
}

/**
 * Main resolver
 */
export function resolveEntitySurfaces({ audits, tolerance = 0.65 } = {}) {
  if (!Array.isArray(audits) || audits.length === 0) {
    return null;
  }

  // Build identity vectors
  const surfaces = audits.map((a) => ({
    audit: a,
    identity: extractIdentityVector(a),
  }));

  // Choose primary surface:
  //  1) highest entityScore
  //  2) fallback to first audit
  let primaryIndex = 0;
  let bestScore = -1;

  surfaces.forEach((s, idx) => {
    const score =
      typeof s.audit?.entityScore === "number"
        ? s.audit.entityScore
        : -1;
    if (score > bestScore) {
      bestScore = score;
      primaryIndex = idx;
    }
  });

  const primary = surfaces[primaryIndex];
  const primaryAudit = primary.audit;

  // Compute identity similarity for each surface vs primary
  const unifiedGroup = [];
  const collisions = [];

  surfaces.forEach((s, idx) => {
    if (idx === primaryIndex) {
      unifiedGroup.push({ ...s, similarity: 1 });
      return;
    }

    const similarity = computeIdentitySimilarity(
      primary.identity,
      s.identity
    );

    if (similarity >= tolerance) {
      unifiedGroup.push({ ...s, similarity });
    } else {
      collisions.push({ ...s, similarity });
    }
  });

  // Identity unification score: median similarity across unifiedGroup
  const sims = unifiedGroup.map((s) => s.similarity || 0);
  sims.sort((a, b) => a - b);
  const mid = Math.floor(sims.length / 2);
  const identityUnificationScore =
    sims.length === 0
      ? 0
      : sims.length % 2 === 1
      ? sims[mid]
      : (sims[mid - 1] + sims[mid]) / 2;

  // Perimeter confidence: average of perimeterConfidence if present,
  // fallback to 0.7 per surface if missing.
  let perimeterSum = 0;
  for (const s of unifiedGroup) {
    const p =
      s.audit?.ontology?.surface?.perimeterConfidence;
    perimeterSum += typeof p === "number" ? p : 0.7;
  }
  const perimeterConfidence =
    unifiedGroup.length > 0
      ? perimeterSum / unifiedGroup.length
      : 0.0;

  // Unified alignment score: weighted average by entityScore
  let alignWeightedSum = 0;
  let alignWeightTotal = 0;

  for (const s of unifiedGroup) {
    const align = s.audit?.ontology?.alignmentScore;
    const score =
      typeof s.audit?.entityScore === "number"
        ? s.audit.entityScore
        : 0;

    if (typeof align === "number") {
      alignWeightedSum += align * (score || 1);
      alignWeightTotal += score || 1;
    }
  }

  const unifiedAlignmentScore =
    alignWeightTotal > 0 ? alignWeightedSum / alignWeightTotal : 0;

  // Aggregate severity across unified surfaces
  const severityRollup = rollupSeverities(
    unifiedGroup.map((s) => s.audit)
  );

  // Unified entityScore
  let avgSurfaceScore = 0;
  if (unifiedGroup.length > 0) {
    const sum = unifiedGroup.reduce(
      (acc, s) =>
        acc +
        (typeof s.audit?.entityScore === "number"
          ? s.audit.entityScore
          : 0),
      0
    );
    avgSurfaceScore = sum / unifiedGroup.length;
  }

  // Score formula:
  //  75% from avg surface score (ontology-adjusted)
  //  + 20 pts from unifiedAlignmentScore (0–1 → 0–20)
  //  + 5 pts from perimeterConfidence (0–1 → 0–5)
  const entityScore = clamp(
    Math.round(
      avgSurfaceScore * 0.75 +
        unifiedAlignmentScore * 20 +
        perimeterConfidence * 5
    ),
    0,
    100
  );

  const entityTier = tierFromScore(entityScore);

  // Primary root domain
  const primaryRoot =
    primary.identity.identityRoot ||
    primary.identity.canonicalRoot ||
    getRootDomain(normalizeHost(primaryAudit.hostname));

  return {
    primaryRoot,
    primaryUrl: primaryAudit.url || primaryAudit.canonical || null,

    // Per-surface summary
    surfaces: surfaces.map((s, idx) => ({
      url: s.audit.url || null,
      hostname: s.audit.hostname || null,
      canonical: s.audit.canonical || null,
      entityName: s.audit.entityName || null,
      entityScore: s.audit.entityScore || null,
      alignmentScore: s.audit.ontology?.alignmentScore ?? null,
      perimeterConfidence:
        s.audit.ontology?.surface?.perimeterConfidence ?? null,
      severity:
        s.audit.ontologySeverity?.topSeverity ??
        s.audit.ontology?.severitySummary?.topSeverity ??
        null,
      isPrimary: idx === primaryIndex,
      similarityToPrimary:
        idx === primaryIndex ? 1 : computeIdentitySimilarity(
          primary.identity,
          s.identity
        ),
    })),

    collisions: collisions.map((s) => ({
      url: s.audit.url || null,
      hostname: s.audit.hostname || null,
      canonical: s.audit.canonical || null,
      similarityToPrimary: s.similarity,
    })),

    perimeterConfidence,
    unifiedAlignmentScore,
    identityUnificationScore,
    severityRollup,

    entityScore,
    entityStage: entityTier.stage,
    entityVerb: entityTier.verb,
    entityDescription: entityTier.description,
    entityFocus: entityTier.coreFocus,
  };
}

export default resolveEntitySurfaces;

