// /lib/ontologyEngine.js — Ontology Engine v0.1 (Phase-2)
// Loads ontology JSON, derives structural context, and evaluates constraints.
//
// Output shape:
// {
//   ontologyVersion,
//   alignmentScore,
//   totalConstraints,
//   passedConstraints,
//   failedConstraints: [{ id, description, reason }],
//   warnings: [],
//   notes: []
// }

import fs from "fs";
import path from "path";
import { deriveOntologyContext } from "./deriveOntologyContext.js";

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

/**
 * Get nested field from context using dotted paths like "canonicalRoots.count"
 */
function getField(ctx, pathStr) {
  if (!pathStr) return undefined;
  const parts = pathStr.split(".");
  let cur = ctx;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Normalize a section (domains, relationships, constraints) so that we always
 * get the array, even when the JSON wraps it in an object.
 */
function normalizeSection(section, arrayKey) {
  if (Array.isArray(section)) return section;
  if (section && Array.isArray(section[arrayKey])) return section[arrayKey];
  return [];
}

/* ---------------------------------------------
   Main: loadOntology()
--------------------------------------------- */

export function loadOntology() {
  const base = path.join(process.cwd(), "ontology");

  const domains = safeLoadJSON(path.join(base, "domains.json"));
  const signals = safeLoadJSON(path.join(base, "signals.json"));
  const relationships = safeLoadJSON(path.join(base, "relationships.json"));
  const constraints = safeLoadJSON(path.join(base, "constraints.json"));
  const versionFile = safeLoadJSON(path.join(base, "version.json"));

  let ontologyVersion = "0.0";
  if (versionFile && typeof versionFile.version === "string") {
    ontologyVersion = versionFile.version;
  } else if (
    constraints &&
    typeof constraints.ontologyVersion === "string"
  ) {
    ontologyVersion = constraints.ontologyVersion;
  }

  return {
    domains,
    signals,
    relationships,
    constraints,
    ontologyVersion,
  };
}

/* ---------------------------------------------
   Core Evaluator: evaluateOntology()
   crawlData = {
     url,
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
    ontologyVersion,
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
     STEP 2 — Build Ontology Context
  --------------------------------------------- */

  const ctx = deriveOntologyContext(crawlData, auditSignalMap);

  /* ---------------------------------------------
     STEP 3 — Constraint Evaluation
  --------------------------------------------- */

  const constraintList = normalizeSection(constraints, "constraints");
  const total = constraintList.length;
  let passed = 0;

  for (const rule of constraintList) {
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
    ontologyVersion,
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
       v0.0 style tests (kept for backward compatibility)
    ----------------------------- */
    case "requireSignal": {
      const sig = ctx.signals[t.key];
      const exists = !!sig?.detected;

      return {
        passed: exists,
        reason: exists ? null : `Required signal missing: ${t.key}`,
      };
    }

    case "canonicalMatchRoot": {
      try {
        const canonicalHost = new URL(ctx.canonical)
          .hostname.replace(/^www\./, "");
        const match = ctx.canonical.includes(canonicalHost);
        return {
          passed: match,
          reason: match
            ? null
            : `Canonical mismatch: expected root '${canonicalHost}'`,
        };
      } catch {
        return {
          passed: false,
          reason: "Canonical invalid or unparsable",
        };
      }
    }

    case "requireOrgSchema": {
      const hasOrg = (ctx.schema || []).some((b) => {
        const t = b["@type"];
        if (Array.isArray(t)) return t.includes("Organization");
        return t === "Organization";
      });

      return {
        passed: hasOrg,
        reason: "No Organization schema detected",
      };
    }

    case "requireBreadcrumbSchema": {
      const hasBreadcrumb = (ctx.schema || []).some((b) => {
        const t = b["@type"];
        if (Array.isArray(t)) return t.includes("BreadcrumbList");
        return t === "BreadcrumbList";
      });

      return {
        passed: hasBreadcrumb,
        reason: "Missing breadcrumb schema",
      };
    }

    case "titlePrefixMatchesOrg": {
      const org = (ctx.schema || []).find((b) => b["@type"] === "Organization");
      if (!org?.name) {
        return {
          passed: false,
          reason: "No org name present to match title prefix",
        };
      }

      const prefix = ctx.title?.split(" | ")[0]?.split(" - ")[0]?.trim();
      const match =
        prefix && prefix.toLowerCase() === org.name.toLowerCase();

      return {
        passed: !!match,
        reason: match
          ? null
          : `Title prefix '${prefix}' does not match org name '${org.name}'`,
      };
    }

    case "minSchemaBlocks": {
      const count = (ctx.schema || []).length;
      const ok = count >= (t.min || 1);

      return {
        passed: ok,
        reason: ok
          ? null
          : `Schema blocks < required min (${t.min || 1}), found ${count}`,
      };
    }

    /* -----------------------------
       Phase-2 constraint types used in constraints.json
       - equality
       - boolean
       - notNull
       - countEquals
    ----------------------------- */

    case "equality": {
      const left = getField(ctx, t.left);
      const right = getField(ctx, t.right);
      const passed = left === right;
      return {
        passed,
        reason: passed
          ? null
          : `Equality failed: ${t.left} (${String(
              left
            )}) !== ${t.right} (${String(right)})`,
      };
    }

    case "boolean": {
      const value = getField(ctx, t.field);
      const passed = value === t.expected;
      return {
        passed,
        reason: passed
          ? null
          : `Boolean failed: ${t.field} was ${String(
              value
            )}, expected ${String(t.expected)}`,
      };
    }

    case "notNull": {
      const value = getField(ctx, t.field);
      const passed = value !== null && value !== undefined && value !== "";
      return {
        passed,
        reason: passed
          ? null
          : `Field ${t.field} must not be null or empty`,
      };
    }

    case "countEquals": {
      const value = getField(ctx, t.field);
      const count =
        typeof value === "number"
          ? value
          : typeof value?.count === "number"
          ? value.count
          : undefined;

      const passed = count === t.expected;
      return {
        passed,
        reason: passed
          ? null
          : `Count mismatch for ${t.field}: ${String(
              count
            )} !== ${String(t.expected)}`,
      };
    }

    /* -----------------------------
       Fallback
    ----------------------------- */
    default:
      return {
        passed: false,
        reason: `Unknown constraint type: ${t.type}`,
      };
  }
}
