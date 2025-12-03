/**
 * exmxc.ai | EEI Audit Engine
 * Phase 3 — Ontology Identity Enforcement Layer
 *
 * Version: 0.0.2-P3
 * Notes:
 * - Injects ontology-based identity constraint testing
 * - All constraint violations DO NOT surface to the UI
 * - Alignment score is stored only on the audit object
 * - Zero schema or test logic disclosed via breakdown bars
 */

import { loadHtml } from "./lib/htmlLoader.js";
import { extractIdentityFields } from "./lib/identityExtractor.js";
import { loadSchemaBlocks } from "./lib/schemaExtractor.js";
import { evaluateCanonical } from "./lib/canonicalUtils.js";
import { evaluateBreadcrumbs } from "./lib/breadcrumbUtils.js";
import { computeEntityScore } from "./lib/scoring.js";
import { computeTierScores } from "./lib/tierScoring.js";
import { analyzeCrawlHealth } from "./lib/crawl.js";

/* NEW PHASE-3 IMPORTS */
import constraints from "../ontology/constraints.json" assert { type: "json" };
import relationships from "../ontology/relationships.json" assert { type: "json" };

const ONTOLOGY_VERSION = "0.0.2";
const MAX_CONSTRAINT_COUNT = constraints.constraints.length;

/**
 * Generic constraint test executor
 */
function runConstraintTest(test, context) {
  const { type } = test;

  switch (type) {
    case "equality": {
      const left = context[test.left];
      const right = context[test.right];
      return left === right;
    }

    case "boolean": {
      return context[test.field] === test.expected;
    }

    case "notNull": {
      return context[test.field] != null;
    }

    case "countEquals": {
      const value = context[test.field];
      return value === test.expected;
    }

    case "minWordCount": {
      const value = context[test.field] || 0;
      return value >= test.min;
    }

    default:
      return false;
  }
}

/**
 * Executes the full Phase-3 identity ontology validation
 */
function runOntologyChecks(context) {
  const failed = [];
  const warnings = [];

  constraints.constraints.forEach((rule) => {
    const result = runConstraintTest(rule.test, context);

    if (!result) {
      failed.push({
        id: rule.id,
        description: rule.description
      });
    }
  });

  const passedCount = MAX_CONSTRAINT_COUNT - failed.length;
  const alignmentScore = passedCount / MAX_CONSTRAINT_COUNT;

  return {
    ontologyVersion: ONTOLOGY_VERSION,
    totalConstraints: MAX_CONSTRAINT_COUNT,
    passedConstraints: passedCount,
    failedConstraints: failed,
    warnings,
    alignmentScore
  };
}

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) throw new Error("Missing URL parameter");

    const html = await loadHtml(url);
    const schemaBlocks = loadSchemaBlocks(html);
    const crawl = analyzeCrawlHealth(html);

    /* Extract identity-layer interpretables */
    const identity = extractIdentityFields(schemaBlocks, html);

    /* Canonical/hostname roots */
    const canonicalEval = evaluateCanonical(schemaBlocks, url, html);
    const breadcrumbEval = evaluateBreadcrumbs(html, canonicalEval.canonicalRoot);

    /**
     * Build ontology context for constraint testing
     * (Fields intentionally limited to what constraints.json expects)
     */
    const ontologyContext = {
      canonicalRoot: canonicalEval.canonicalRoot || null,
      canonicalRoots: canonicalEval.canonicalRoots || [],
      canonicalIsClean: canonicalEval.canonicalIsClean,
      identityRoot: identity.identityRoot || null,
      entityName: identity.entityName || null,
      orgSchemaName: identity.orgSchemaName || null,
      orgSchemasAllHaveSameName: identity.orgSchemasAllHaveSameName,
      allSchemaUseSchemaOrg: identity.allSchemaUseSchemaOrg,
      personSchemaDoesNotConflict: identity.personSchemaDoesNotConflict,
      hostnameMatchesIdentityRoot: identity.hostnameMatchesIdentityRoot,
      identityRootsUnified: identity.identityRootsUnified,
      hasOrgOrPersonSchema: identity.hasOrgOrPersonSchema,
      breadcrumbRoot: breadcrumbEval.root,
      breadcrumbHierarchyValid: breadcrumbEval.hierarchyValid,
      wordCount: crawl.wordCount,
      hasInternalLinks: crawl.internalLinkCount > 0
    };

    /* Phase 3 Ontology Evaluation */
    const ontology = runOntologyChecks(ontologyContext);

    /**
     * Compute core EEI score (surface scoring remains unchanged)
     */
    const entityScoreBase = computeEntityScore({
      ...identity,
      ...canonicalEval,
      ...breadcrumbEval,
      schemaBlocks,
      crawl
    });

    const entityScore = Math.round(
      entityScoreBase + ontology.alignmentScore * 2 // small invisible lift
    );

    const tierScores = computeTierScores({
      score: entityScore,
      identity,
      crawl,
      schemaBlocks
    });

    return res.status(200).json({
      success: true,
      url,
      hostname: identity.hostname,
      entityName: identity.entityName || null,
      title: identity.title,
      canonical: canonicalEval.canonical,
      description: identity.metaDescription,
      entityScoreBase,
      entityScoreOntologyAdjusted: Math.round(
        entityScoreBase + ontology.alignmentScore * 2
      ),
      entityScore,

      entityStage: identity.stage,
      entityVerb: identity.verb,
      entityDescription: identity.description,
      entityFocus: identity.focus,
      breakdown: identity.breakdownBars,
      scoringBars: identity.breakdownBars,
      tierScores,

      schemaMeta: {
        schemaBlocks: schemaBlocks?.length || 0,
        mode: identity.schemaMode,
        httpStatus: crawl.status,
        latestISO: identity.isoTimestamp || null
      },

      crawlHealth: crawl,

      /* INTERNAL ONLY */
      ontology,
      ontologyRelationships: relationships,

      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
