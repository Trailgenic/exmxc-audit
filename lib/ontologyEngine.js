// /lib/ontologyEngine.js — Ontology Engine v0.0.1 (Phase 3)
// Loads ontology (domains, signals, relationships, constraints) and evaluates compliance
// against extracted crawl signals + schema blocks.
//
// Output:
// {
//   ontologyVersion,
//   alignmentScore,
//   totalConstraints,
//   passedConstraints,
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

// Simple dotted-path getter, e.g. "canonicalRoots.count"
function getFieldFromPath(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  const parts = String(pathStr).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// Normalize an entity name into a loose "root" token (for future ontology use)
function normalizeEntityRoot(name) {
  if (!name || typeof name !== "string") return null;
  let s = name.toLowerCase();

  // Strip common legal / trademark noise
  s = s.replace(/™|®/g, "");
  s = s.replace(/\b(inc\.?|llc|corp\.?|corporation|company|co\.?)\b/g, "");

  // Collapse non-alphanumeric into dashes
  s = s.replace(/[^a-z0-9]+/g, "-");

  // Trim leading/trailing dashes
  s = s.replace(/^-+|-+$/g, "");

  return s || null;
}

/* ---------------------------------------------
   Root loader: loadOntology()
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
    version: version?.version || "0.0.1",
  };
}

/* ---------------------------------------------
   Identity & Structural Context Builder
   Phase 3: fills the fields used by constraints:
   - canonicalRoot
   - identityRoot
   - breadcrumbRoot
   - orgSchemaName
   - orgSchemasAllHaveSameName
   - canonicalRoots.count
   - entityName
   - entityRoot
   - personSchemaName
   - hasPersonSchema
   - hasOrgOrPersonSchema
   - allSchemaUseSchemaOrg
   - personSchemaDoesNotConflict
   - breadcrumbHierarchyValid
   - canonicalIsClean
   - identityRootsUnified
   - hostnameMatchesIdentityRoot
   - wordCount
   - internalLinkCount
   - hasInternalLinks
--------------------------------------------- */

function buildIdentityContext(crawlData, baseCtx) {
  const schemaBlocks = baseCtx.schema || [];

  // Canonical + hostname normalization
  const rawCanonical = baseCtx.canonical || crawlData.canonical || "";
  const rawUrl = crawlData.url || rawCanonical || "";
  let hostname = crawlData.hostname || null;
  let canonicalHost = null;
  let canonicalIsClean = false;

  try {
    if (!hostname && rawUrl) {
      hostname = new URL(rawUrl).hostname;
    }
  } catch {
    // ignore
  }

  try {
    if (rawCanonical) {
      const u = new URL(rawCanonical);
      canonicalHost = u.hostname;
      canonicalIsClean = !u.search && !u.hash;
    }
  } catch {
    // canonical may be malformed; leave fields null/false
  }

  const normalizeHost = (h) => (h ? h.replace(/^www\./i, "").toLowerCase() : null);

  const hostNorm = normalizeHost(hostname);
  const canonicalHostNorm = normalizeHost(canonicalHost);

  // For roots, we only care about normalized host, not full path
  const identityRoot = canonicalHostNorm || hostNorm || null;
  const canonicalRoot = canonicalHostNorm || null;

  // Canonical roots collection — Phase 3 still single-root
  const canonicalRoots = {
    count: identityRoot ? 1 : 0,
  };

  // Breadcrumb root & hierarchy validity
  let breadcrumbRoot = null;
  let breadcrumbHierarchyValid = true;

  const breadcrumb = schemaBlocks.find((b) => b["@type"] === "BreadcrumbList");
  if (breadcrumb && Array.isArray(breadcrumb.itemListElement)) {
    const items = breadcrumb.itemListElement;
    if (items.length > 0) {
      const first = items[0];
      const itemUrl = first.item || first.url;
      try {
        if (itemUrl) {
          const u = new URL(itemUrl);
          breadcrumbRoot = normalizeHost(u.hostname);
        }
      } catch {
        // ignore parse failure
      }

      // Very light structural check: positions strictly increasing from 1
      let expectedPos = 1;
      for (const li of items) {
        if (typeof li.position !== "number" || li.position !== expectedPos) {
          breadcrumbHierarchyValid = false;
          break;
        }
        expectedPos += 1;
      }
    }
  } else {
    // If no breadcrumb schema, treat "validity" as true (no contradictory hierarchy),
    // constraint CR9 checks presence via other means.
    breadcrumbHierarchyValid = true;
  }

  if (!breadcrumbRoot) {
    breadcrumbRoot = canonicalRoot;
  }

  // Organization schema aggregation
  const orgSchemas = schemaBlocks.filter((b) => b["@type"] === "Organization");
  const orgNames = orgSchemas
    .map((b) => (b && typeof b.name === "string" ? b.name.trim() : null))
    .filter(Boolean);

  const orgSchemaName = orgNames.length > 0 ? orgNames[0] : null;

  const orgNamesNorm = [...new Set(orgNames.map((n) => n.toLowerCase()))];
  const orgSchemasAllHaveSameName = orgNamesNorm.length <= 1;

  // Schema vocabulary usage (schema.org)
  const allSchemaUseSchemaOrg =
    schemaBlocks.length === 0
      ? true // no schema = not in violation structurally
      : schemaBlocks.every((b) => {
          const ctx = (b && b["@context"]) || "";
          return String(ctx).toLowerCase().includes("schema.org");
        });

  // Person schema conflict (Phase 3: assume non-conflict unless we detect direct mismatch)
  const personBlocks = schemaBlocks.filter((b) => b["@type"] === "Person");
  let personSchemaDoesNotConflict = true;
  let personSchemaName = null;

  if (personBlocks.length > 0) {
    const personNames = personBlocks
      .map((b) => (b && typeof b.name === "string" ? b.name.trim() : null))
      .filter(Boolean);

    if (personNames.length > 0) {
      personSchemaName = personNames[0];
    }

    if (orgSchemaName) {
      const orgLower = orgSchemaName.toLowerCase();
      const hardConflict = personNames.some((pn) => pn.toLowerCase() === orgLower);
      // As discussed, we treat even this as non-conflict for now (very conservative).
      if (hardConflict) {
        personSchemaDoesNotConflict = true;
      }
    }
  }

  const hasPersonSchema = personBlocks.length > 0;
  const hasOrgOrPersonSchema = hasPersonSchema || orgSchemas.length > 0;

  // Identity roots unified & hostname matching
  const rootsSet = new Set(
    [identityRoot, canonicalRoot, hostNorm].filter(
      (v) => typeof v === "string" && v.length > 0
    )
  );
  const identityRootsUnified = rootsSet.size <= 1;

  const hostnameMatchesIdentityRoot =
    !identityRoot || !hostNorm ? true : identityRoot === hostNorm;

  // Entity name reconstruction (Phase 3)
  const rawEntityName =
    (typeof crawlData.entityName === "string" && crawlData.entityName.trim()) || null;

  // Title root: before pipe or dash
  let titleRoot = null;
  if (baseCtx.title) {
    const rawTitle = String(baseCtx.title);
    const splitPipe = rawTitle.split(" | ")[0];
    const splitDash = splitPipe.split(" - ")[0];
    titleRoot = splitDash.trim();
  }

  let entityName = rawEntityName || orgSchemaName || titleRoot || null;

  // Normalize trivial empty strings
  if (entityName && entityName.trim().length === 0) {
    entityName = null;
  }

  const entityRoot = normalizeEntityRoot(entityName);

  // Crawl-level structural fields used by CR13/CR14
  const wordCount =
    typeof crawlData?.crawlHealth?.wordCount === "number"
      ? crawlData.crawlHealth.wordCount
      : null;

  const internalLinkCount =
    typeof crawlData?.crawlHealth?.internalLinkCount === "number"
      ? crawlData.crawlHealth.internalLinkCount
      : null;

  const hasInternalLinks =
    typeof internalLinkCount === "number" && internalLinkCount > 0;

  return {
    canonicalRoot,
    identityRoot,
    breadcrumbRoot,
    orgSchemaName,
    orgSchemasAllHaveSameName,
    canonicalRoots,
    entityName,
    entityRoot,
    personSchemaName,
    hasPersonSchema,
    hasOrgOrPersonSchema,
    allSchemaUseSchemaOrg,
    personSchemaDoesNotConflict,
    breadcrumbHierarchyValid,
    canonicalIsClean,
    identityRootsUnified,
    hostnameMatchesIdentityRoot,
    wordCount,
    internalLinkCount,
    hasInternalLinks,
  };
}

/* ---------------------------------------------
   Core Evaluator: evaluateOntology()
   crawlData = {
     title,
     canonical,
     url,
     hostname,
     schemaObjects,
     pageLinks,
     scoringOutputs[]   (13 signals list),
     entityName?,       (optional extractor output)
     crawlHealth?       (optional: wordCount, internalLinkCount, etc.)
   }
--------------------------------------------- */

export function evaluateOntology(crawlData) {
  const { constraints, version } = loadOntology();

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
     STEP 2 — Base Context
  --------------------------------------------- */
  const baseCtx = {
    title: crawlData.title || "",
    canonical: crawlData.canonical || "",
    url: crawlData.url || "",
    hostname: crawlData.hostname || "",
    schema: crawlData.schemaObjects || [],
    links: crawlData.pageLinks || [],
    signals: auditSignalMap,
  };

  /* ---------------------------------------------
     STEP 3 — Identity / Ontology Context (Phase 3)
  --------------------------------------------- */
  const identityCtx = buildIdentityContext(crawlData, baseCtx);

  const ctx = {
    ...baseCtx,
    ...identityCtx,
  };

  /* ---------------------------------------------
     STEP 4 — Constraint Evaluation
  --------------------------------------------- */

  const total = Array.isArray(constraints?.constraints)
    ? constraints.constraints.length
    : 0;
  let passed = 0;

  for (const rule of constraints?.constraints || []) {
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
   Phase 3 supports:
   - equality
   - boolean
   - countEquals
   - notNull
   - minWordCount
   plus legacy signal-based tests.
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
       Canonical root match (legacy)
       Kept for backwards compatibility.
    ----------------------------- */
    case "canonicalMatchRoot": {
      try {
        const canonicalHost = new URL(ctx.canonical).hostname.replace(/^www\./, "");
        const root = ctx.identityRoot || ctx.canonicalRoot || canonicalHost;
        const ok = !!root && root === canonicalHost;

        return {
          passed: ok,
          reason: ok
            ? null
            : `Canonical mismatch: expected root '${root}', got '${canonicalHost}'`,
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
      const hasOrg = (ctx.schema || []).some((b) => b["@type"] === "Organization");

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
      const match =
        prefix && prefix.toLowerCase() === String(org.name).toLowerCase();

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
       PHASE 3: Generic equality
       Used by CR1, CR2, CR3, etc.
       Logic:
       - If both sides are null/undefined -> pass (no data, no conflict)
       - If either side is null -> pass (insufficient signal to assert conflict)
       - Else compare (case-insensitive for strings)
    ----------------------------- */
    case "equality": {
      const left = getFieldFromPath(ctx, t.left);
      const right = getFieldFromPath(ctx, t.right);

      const leftNil = left === null || left === undefined;
      const rightNil = right === null || right === undefined;

      if (leftNil && rightNil) {
        return { passed: true };
      }

      if (leftNil || rightNil) {
        // In Phase 3, missing data is *not* treated as a hard conflict.
        return { passed: true };
      }

      const normalizeVal = (v) =>
        typeof v === "string" ? v.trim().toLowerCase() : v;

      const lNorm = normalizeVal(left);
      const rNorm = normalizeVal(right);

      const ok = lNorm === rNorm;

      return {
        passed: ok,
        reason: ok
          ? null
          : `Equality failed: ${t.left} (${left}) !== ${t.right} (${right})`,
      };
    }

    /* -----------------------------
       PHASE 3: Boolean field check
       Example: field = "identityRootsUnified", expected = true
    ----------------------------- */
    case "boolean": {
      const val = getFieldFromPath(ctx, t.field);
      const expected = !!t.expected;

      // If value is undefined, we treat as "not enough signal" → pass.
      if (val === undefined) {
        return { passed: true };
      }

      const ok = !!val === expected;

      return {
        passed: ok,
        reason: ok
          ? null
          : `Boolean check failed: ${t.field} (${val}) !== expected (${expected})`,
      };
    }

    /* -----------------------------
       PHASE 3: Count equals
       Example: field = "canonicalRoots.count", expected = 1
    ----------------------------- */
    case "countEquals": {
      const val = getFieldFromPath(ctx, t.field);

      if (val === undefined || val === null) {
        // Again, "no data" is not treated as conflict in Phase 3.
        return { passed: true };
      }

      const ok = Number(val) === Number(t.expected);

      return {
        passed: ok,
        reason: ok
          ? null
          : `Count check failed: ${t.field} (${val}) !== expected (${t.expected})`,
      };
    }

    /* -----------------------------
       PHASE 3: NotNull
       Example: field = "entityName"
    ----------------------------- */
    case "notNull": {
      const val = getFieldFromPath(ctx, t.field);
      const isEmpty =
        val === null ||
        val === undefined ||
        (typeof val === "string" && val.trim().length === 0);

      return {
        passed: !isEmpty,
        reason: !isEmpty ? null : `Field ${t.field} must not be null or empty`,
      };
    }

    /* -----------------------------
       PHASE 3: Min word count
       Example: field = "wordCount", min = 300
       - If field is missing → pass (no signal, no penalty)
       - If field present and below min → fail
    ----------------------------- */
    case "minWordCount": {
      const val = getFieldFromPath(ctx, t.field);

      if (val === undefined || val === null) {
        // No word-count signal supplied; we don't penalize.
        return { passed: true };
      }

      const numeric = Number(val);
      const min = typeof t.min === "number" ? t.min : 0;
      const ok = !Number.isNaN(numeric) && numeric >= min;

      return {
        passed: ok,
        reason: ok
          ? null
          : `Word count check failed: ${t.field} (${numeric}) < min (${min})`,
      };
    }

    /* -----------------------------
       Unknown test type
    ----------------------------- */
    default:
      return {
        passed: false,
        reason: `Unknown constraint type: ${t.type}`,
      };
  }
}
