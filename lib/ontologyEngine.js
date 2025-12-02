// /lib/ontologyEngine.js — Ontology Engine v0.0
// Loads ontology (domains, relationships, constraints) and evaluates compliance
// against extracted crawl signals + schema blocks.
//
// Output:
// {
//   ontologyVersion,
//   alignmentScore,
//   totalConstraints,
//   failedConstraints: [],
//   warnings: [],
//   notes: []
// }

import fs from "fs";
import path from "path";

/* ---------------------------------------------
   Helpers
--------------------------------------------- */

function safeLoadJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    return {
      _error: `Failed to load ${filePath}`,
      details: err.message || String(err),
    };
  }
}

function clamp(n, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n));
}

/* ---------------------------------------------
   Main: loadOntology()
   Root loader for:
   - domains
   - signals
   - relationships
   - constraints
   - version
--------------------------------------------- */

export function loadOntology() {
  const base = path.join(process.cwd(), "ontology");

  const domains = safeLoadJSON(path.join(base, "domains.json"));
  const signals = safeLoadJSON(path.join(base, "signals.json"));
  const relationships = safeLoadJSON(path.join(base, "relationships.json"));
  const constraints = safeLoadJSON(path.join(base, "constraints.json"));
  const version = safeLoadJSON(path.join(base, "version.json"));

  return {
    domains,
    signals,
    relationships,
    constraints,
    version: version?.version || "0.0",
  };
}

/* ---------------------------------------------
   Core Evaluator: evaluateOntology()
   crawlData = {
     title,
     canonical,
     schemaObjects,
     pageLinks,
     scoringOutputs[]   (13 signals list)
   }
--------------------------------------------- */

export function evaluateOntology(crawlData) {
  const {
    domains,
    signals,
    relationships,
    constraints,
    version,
  } = loadOntology();

  const notes = [];
  const warnings = [];
  const failedConstraints = [];

  /* ---------------------------------------------
     STEP 1 — Normalize Signal Presence
     Map audit scoring signals into ontology keys
  --------------------------------------------- */

  const auditSignalMap = {};
  for (const sig of crawlData.scoringOutputs || []) {
    auditSignalMap[sig.key] = {
      detected: sig.points > 0,
      score: sig.points,
      max: sig.max,
      percent: sig.max ? sig.points / sig.max : 0,
    };
  }

  /* ---------------------------------------------
     STEP 2 — Build Context
     (Minimal context for v0.0)
  --------------------------------------------- */
  const ctx = {
    title: crawlData.title || "",
    canonical: crawlData.canonical || "",
    schema: crawlData.schemaObjects || [],
    links: crawlData.pageLinks || [],
    signals: auditSignalMap,
  };

  /* ---------------------------------------------
     STEP 3 — Constraint Evaluation
  --------------------------------------------- */

  const total = (constraints || []).length;
  let passed = 0;

  for (const rule of constraints || []) {
    const result = applyConstraint(rule, ctx);

    if (result.passed) {
      passed++;
    } else {
      failedConstraints.push({
        id: rule.id,
        description: rule.description,
        reason: result.reason || "Constraint failed, no reason provided",
      });
    }

    if (result.warning) warnings.push(result.warning);
    if (result.note) notes.push(result.note);
  }

  const alignmentScore = total > 0 ? passed / total : 0;

  return {
    ontologyVersion: version,
    alignmentScore: Number(alignmentScore.toFixed(3)),
    totalConstraints: total,
    passedConstraints: passed,
    failedConstraints,
    warnings,
    notes,
  };
}

/* ---------------------------------------------
   Constraint Resolver
   Each rule has:
   - id
   - description
   - test: { type, ...params }
--------------------------------------------- */

function applyConstraint(rule, ctx) {
  if (!rule?.test?.type) {
    return {
      passed: false,
      reason: "Malformed constraint: missing test.type",
    };
  }

  const t = rule.test;

  switch (t.type) {
    /* -----------------------------
       Require a signal be present
    ----------------------------- */
    case "requireSignal": {
      const sig = ctx.signals[t.key];
      const exists = !!sig?.detected;

      return {
        passed: exists,
        reason: exists ? null : `Required signal missing: ${t.key}`,
      };
    }

    /* -----------------------------
       Canonical Root Match
    ----------------------------- */
    case "canonicalMatchRoot": {
      try {
        const canonicalHost = new URL(ctx.canonical).hostname.replace(/^www\./, "");
        return {
          passed: ctx.canonical.includes(canonicalHost),
          reason: `Canonical mismatch: expected root '${canonicalHost}'`,
        };
      } catch {
        return {
          passed: false,
          reason: "Canonical invalid or unparsable",
        };
      }
    }

    /* -----------------------------
       Require org schema
    ----------------------------- */
    case "requireOrgSchema": {
      const hasOrg = (ctx.schema || []).some(
        (b) => b["@type"] === "Organization"
      );

      return {
        passed: hasOrg,
        reason: "No Organization schema detected",
      };
    }

    /* -----------------------------
       Require breadcrumb schema
    ----------------------------- */
    case "requireBreadcrumbSchema": {
      const hasBreadcrumb = (ctx.schema || []).some(
        (b) => b["@type"] === "BreadcrumbList"
      );

      return {
        passed: hasBreadcrumb,
        reason: "Missing breadcrumb schema",
      };
    }

    /* -----------------------------
       Title prefix must match schema org name
       Basic check: strict name equality
    ----------------------------- */
    case "titlePrefixMatchesOrg": {
      const org = (ctx.schema || []).find((b) => b["@type"] === "Organization");
      if (!org?.name) {
        return {
          passed: false,
          reason: "No org name present to match title prefix",
        };
      }

      const prefix = ctx.title?.split(" | ")[0]?.split(" - ")[0]?.trim();
      const match = prefix && prefix.toLowerCase() === org.name.toLowerCase();

      return {
        passed: !!match,
        reason: `Title prefix '${prefix}' does not match org name '${org.name}'`,
      };
    }

    /* -----------------------------
       Minimum schema blocks
    ----------------------------- */
    case "minSchemaBlocks": {
      const count = (ctx.schema || []).length;
      const ok = count >= (t.min || 1);

      return {
        passed: ok,
        reason: `Schema blocks < required min (${t.min})`,
      };
    }

    /* -----------------------------
       Unrecognized test
    ----------------------------- */
    default:
      return {
        passed: false,
        reason: `Unknown constraint type: ${t.type}`,
      };
  }
}
