// /lib/ontologyEngine.js — Ontology Engine v0.0.2 (Phase 3 + Phase 4)
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
//   notes: [],
//   identity: { ... },
//   surface: { ... }
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

  const normalizeHost = (h) =>
    (h ? h.replace(/^www\./i, "").toLowerCase() : null);

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
      ? true
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
      const hardConflict = personNames.some(
        (pn) => pn.toLowerCase() === orgLower
      );
      // For now, we treat even this as non-conflict (very conservative).
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
    (typeof crawlData.entityName === "string" &&
      crawlData.entityName.trim()) ||
    null;

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
   Phase 4: Multi-surface / perimeter context
--------------------------------------------- */

function evaluateSurfaceCohesion(crawlData, baseCtx, identityCtx) {
  const schemaBlocks = baseCtx.schema || [];
  const scoringOutputs = Array.isArray(crawlData.scoringOutputs)
    ? crawlData.scoringOutputs
    : [];

  // Helper: normalize hostname + strip www
  const normalizeHost = (h) =>
    h ? String(h).toLowerCase().replace(/^www\./i, "") : null;

  // Helper: very simple registrable root (last 2 labels)
  const getRootDomain = (host) => {
    if (!host) return null;
    const parts = String(host).split(".").filter(Boolean);
    if (parts.length <= 2) return host;
    return parts.slice(-2).join(".");
  };

  /* --- 1) Collect Organization.sameAs hosts --- */
  const sameAsHosts = new Set();
  const orgBlocks = schemaBlocks.filter((b) => b && b["@type"] === "Organization");

  for (const org of orgBlocks) {
    let sameAs = [];
    if (Array.isArray(org.sameAs)) {
      sameAs = org.sameAs;
    } else if (typeof org.sameAs === "string") {
      sameAs = [org.sameAs];
    }

    for (const urlStr of sameAs) {
      try {
        const u = new URL(urlStr);
        sameAsHosts.add(normalizeHost(u.hostname));
      } catch {
        // ignore bad URLs
      }
    }
  }

  /* --- 2) Collect social + outbound hosts from scoring raw --- */
  const socialHosts = new Set();
  const outboundHosts = new Set();

  for (const sig of scoringOutputs) {
    if (sig?.key === "Social Entity Links" && sig.raw) {
      const list = Array.isArray(sig.raw.distinctSocialHosts)
        ? sig.raw.distinctSocialHosts
        : [];
      for (const h of list) {
        socialHosts.add(normalizeHost(h));
      }
    }

    if (sig?.key === "External Authority Signal" && sig.raw) {
      const list = Array.isArray(sig.raw.distinctOutboundHosts)
        ? sig.raw.distinctOutboundHosts
        : [];
      for (const h of list) {
        outboundHosts.add(normalizeHost(h));
      }
    }
  }

  /* --- 3) Build perimeter roots --- */
  const identityHost =
    identityCtx.identityRoot ||
    identityCtx.canonicalRoot ||
    normalizeHost(baseCtx.hostname);

  const identityRootDomain = getRootDomain(identityHost);

  const surfaceRootSet = new Set();
  if (identityRootDomain) surfaceRootSet.add(identityRootDomain);

  for (const h of sameAsHosts) {
    const root = getRootDomain(h);
    if (root) surfaceRootSet.add(root);
  }
  for (const h of socialHosts) {
    const root = getRootDomain(h);
    if (root) surfaceRootSet.add(root);
  }

  const surfaceRoots = Array.from(surfaceRootSet).filter(Boolean);
  const surfaceCount = surfaceRoots.length;
  const hasMultiSurfacePresence = surfaceCount > 1;

  /* --- 4) Schema name root unification (schemaRootsUnified) --- */
  const nameCandidates = [];

  if (identityCtx.entityName) nameCandidates.push(identityCtx.entityName);
  if (
    identityCtx.orgSchemaName &&
    identityCtx.orgSchemaName !== identityCtx.entityName
  )
    nameCandidates.push(identityCtx.orgSchemaName);

  // Pull legalName / alternateName variants from org schema
  for (const org of orgBlocks) {
    if (typeof org.legalName === "string") {
      nameCandidates.push(org.legalName);
    }
    if (Array.isArray(org.alternateName)) {
      for (const alt of org.alternateName) {
        if (typeof alt === "string") nameCandidates.push(alt);
      }
    } else if (typeof org.alternateName === "string") {
      nameCandidates.push(org.alternateName);
    }
  }

  const normalizedRoots = new Set(
    nameCandidates
      .map((n) => normalizeEntityRoot(n))
      .filter((v) => v && v.length > 0)
  );

  const schemaRootsUnified = normalizedRoots.size <= 1;

  /* --- 5) sameAs vs social host overlap --- */
  const sameAsHostList = Array.from(sameAsHosts).filter(Boolean);
  const socialHostList = Array.from(socialHosts).filter(Boolean);

  let sameAsOverlapIndex = null;
  let sameAsOverlapStrong = true; // default "no signal = no penalty"

  if (sameAsHostList.length > 0 && socialHostList.length > 0) {
    const socialHostSet = new Set(socialHostList);
    let intersectionCount = 0;
    for (const h of sameAsHostList) {
      if (socialHostSet.has(h)) intersectionCount++;
    }

    const unionSet = new Set([...sameAsHostList, ...socialHostList]);
    sameAsOverlapIndex =
      unionSet.size > 0 ? intersectionCount / unionSet.size : 0;

    sameAsOverlapStrong = sameAsOverlapIndex >= 0.5;
  }

  /* --- 6) Canonical convergence (Phase 4 variant) --- */
  const canonicalConvergenceStrong =
    identityCtx.canonicalRoots && identityCtx.canonicalRoots.count === 1;

  /* --- 7) Multi-surface schema coherence --- */
  const multiSurfaceSchemaCoherent =
    !hasMultiSurfacePresence || !!identityCtx.hasOrgOrPersonSchema;

  /* --- 8) Digital perimeter stability --- */
  const digitalPerimeterStable = hasMultiSurfacePresence
    ? canonicalConvergenceStrong && schemaRootsUnified && sameAsOverlapStrong
    : true;

  return {
    surfaceCount,
    surfaceRoots,
    hasMultiSurfacePresence,
    sameAsOverlapIndex,
    sameAsOverlapStrong,
    schemaRootsUnified,
    canonicalConvergenceStrong,
    multiSurfaceSchemaCoherent,
    digitalPerimeterStable,
  };
}

/* ---------------------------------------------
   Core Evaluator: evaluateOntology()
--------------------------------------------- */

export function evaluateOntology(crawlData) {
  const { constraints, version } = loadOntology();

  const notes = [];
  const warnings = [];
  const failedConstraints = [];

  /* STEP 1 — Normalize Signal Presence */
  const auditSignalMap = {};
  for (const sig of crawlData.scoringOutputs || []) {
    auditSignalMap[sig.key] = {
      detected: sig.points > 0,
      score: sig.points,
      max: sig.max,
      percent: sig.max ? sig.points / sig.max : 0,
    };
  }

  /* STEP 2 — Base Context */
  const baseCtx = {
    title: crawlData.title || "",
    canonical: crawlData.canonical || "",
    url: crawlData.url || "",
    hostname: crawlData.hostname || "",
    schema: crawlData.schemaObjects || [],
    links: crawlData.pageLinks || [],
    signals: auditSignalMap,
  };

  /* STEP 3 — Identity Context */
  const identityCtx = buildIdentityContext(crawlData, baseCtx);

  /* STEP 4 — Surface / Perimeter Context */
  const surfaceCtx = evaluateSurfaceCohesion(crawlData, baseCtx, identityCtx);

  const ctx = {
    ...baseCtx,
    ...identityCtx,
    ...surfaceCtx,
  };

  /* STEP 5 — Constraint Evaluation */
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
    identity: {
      canonicalRoot: identityCtx.canonicalRoot,
      identityRoot: identityCtx.identityRoot,
      breadcrumbRoot: identityCtx.breadcrumbRoot,
      orgSchemaName: identityCtx.orgSchemaName,
      entityName: identityCtx.entityName,
      entityRoot: identityCtx.entityRoot,
      hasOrgOrPersonSchema: identityCtx.hasOrgOrPersonSchema,
      wordCount: identityCtx.wordCount,
      internalLinkCount: identityCtx.internalLinkCount,
    },
    surface: {
      surfaceCount: surfaceCtx.surfaceCount,
      surfaceRoots: surfaceCtx.surfaceRoots,
      hasMultiSurfacePresence: surfaceCtx.hasMultiSurfacePresence,
      sameAsOverlapIndex: surfaceCtx.sameAsOverlapIndex,
      sameAsOverlapStrong: surfaceCtx.sameAsOverlapStrong,
      schemaRootsUnified: surfaceCtx.schemaRootsUnified,
      canonicalConvergenceStrong: surfaceCtx.canonicalConvergenceStrong,
      multiSurfaceSchemaCoherent: surfaceCtx.multiSurfaceSchemaCoherent,
      digitalPerimeterStable: surfaceCtx.digitalPerimeterStable,
    },
  };
}

/* ---------------------------------------------
   Constraint Resolver
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
        const canonicalHost = new URL(ctx.canonical).hostname.replace(
          /^www\./,
          ""
        );
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

    case "requireOrgSchema": {
      const hasOrg = (ctx.schema || []).some(
        (b) => b["@type"] === "Organization"
      );

      return {
        passed: hasOrg,
        reason: "No Organization schema detected",
      };
    }

    case "requireBreadcrumbSchema": {
      const hasBreadcrumb = (ctx.schema || []).some(
        (b) => b["@type"] === "BreadcrumbList"
      );

      return {
        passed: hasBreadcrumb,
        reason: "Missing breadcrumb schema",
      };
    }

    case "titlePrefixMatchesOrg": {
      const org = (ctx.schema || []).find(
        (b) => b["@type"] === "Organization"
      );
      if (!org?.name) {
        return {
          passed: false,
          reason: "No org name present to match title prefix",
        };
      }

      const prefix = ctx.title
        ?.split(" | ")[0]
        ?.split(" - ")[0]
        ?.trim();
      const match =
        prefix && prefix.toLowerCase() === String(org.name).toLowerCase();

      return {
        passed: !!match,
        reason: `Title prefix '${prefix}' does not match org name '${org.name}'`,
      };
    }

    case "minSchemaBlocks": {
      const count = (ctx.schema || []).length;
      const ok = count >= (t.min || 1);

      return {
        passed: ok,
        reason: `Schema blocks < required min (${t.min})`,
      };
    }

    case "equality": {
      const left = getFieldFromPath(ctx, t.left);
      const right = getFieldFromPath(ctx, t.right);

      const leftNil = left === null || left === undefined;
      const rightNil = right === null || right === undefined;

      if (leftNil && rightNil) {
        return { passed: true };
      }

      if (leftNil || rightNil) {
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

    case "boolean": {
      const val = getFieldFromPath(ctx, t.field);
      const expected = !!t.expected;

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

    case "countEquals": {
      const val = getFieldFromPath(ctx, t.field);

      if (val === undefined || val === null) {
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

    case "minWordCount": {
      const val = getFieldFromPath(ctx, t.field);

      if (val === undefined || val === null) {
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

    default:
      return {
        passed: false,
        reason: `Unknown constraint type: ${t.type}`,
      };
  }
}
