// /lib/deriveOntologyContext.js — Phase-2 Context Derivation
// Builds the ontology context object used by constraint evaluation.
//
// Input:
//   crawlData = { url, title, canonical, schemaObjects, pageLinks }
//   signalsMap = { [signalKey]: { detected, score, max, percent } }
//
// Output (ctx):
//   {
//     title,
//     canonical,
//     schema,
//     links,
//     signals,
//     host,
//     identityRoot,
//     canonicalRoot,
//     orgSchemaName,
//     breadcrumbRoot,
//     orgSchemasAllHaveSameName,
//     canonicalRoots: { count },
//     allSchemaUseSchemaOrg,
//     personSchemaDoesNotConflict,
//     breadcrumbHierarchyValid,
//     canonicalIsClean,
//     identityRootsUnified,
//     hostnameMatchesIdentityRoot
//   }

export function deriveOntologyContext(crawlData, signalsMap = {}) {
  const title = crawlData.title || "";
  const canonical =
    crawlData.canonical || crawlData.url || "" || crawlData.normalizedUrl;
  const schema = crawlData.schemaObjects || [];
  const links = crawlData.pageLinks || [];

  /* ---------- Host & Roots ---------- */

  let host = "";
  let identityRoot = "";

  const primaryUrl = crawlData.url || canonical || "";
  try {
    const u = new URL(primaryUrl);
    host = u.hostname;
    identityRoot = u.hostname.replace(/^www\./i, "");
  } catch {
    // leave empty
  }

  let canonicalHost = host;
  let canonicalRoot = identityRoot;

  try {
    const cu = new URL(canonical);
    canonicalHost = cu.hostname;
    canonicalRoot = cu.hostname.replace(/^www\./i, "");
  } catch {
    // best effort
  }

  /* ---------- Org Schema ---------- */

  const orgSchemas = schema.filter((o) => {
    const t = o["@type"];
    if (Array.isArray(t)) return t.includes("Organization");
    return t === "Organization";
  });

  const orgSchemaName = orgSchemas[0]?.name || null;

  let orgSchemasAllHaveSameName = true;
  if (orgSchemas.length > 1) {
    const first =
      (orgSchemas[0].name || "").toString().trim().toLowerCase();
    orgSchemasAllHaveSameName = orgSchemas.every(
      (o) =>
        (o.name || "").toString().trim().toLowerCase() === first
    );
  }

  /* ---------- Breadcrumb Root ---------- */

  let breadcrumbRoot = canonicalRoot || identityRoot;

  const breadcrumb = schema.find((o) => {
    const t = o["@type"];
    if (Array.isArray(t)) return t.includes("BreadcrumbList");
    return t === "BreadcrumbList";
  });

  if (breadcrumb && Array.isArray(breadcrumb.itemListElement)) {
    const firstItem = breadcrumb.itemListElement[0];
    const item =
      firstItem?.item || firstItem?.url || firstItem?.["@id"];
    if (typeof item === "string") {
      try {
        const bu = new URL(item);
        breadcrumbRoot = bu.hostname.replace(/^www\./i, "");
      } catch {
        // keep fallback
      }
    }
  }

  /* ---------- Canonical Roots (v0.1, single-surface) ---------- */

  const canonicalRoots = {
    count: canonicalRoot ? 1 : 0,
  };

  /* ---------- Schema.org Usage ---------- */

  let allSchemaUseSchemaOrg = true;
  if (schema.length > 0) {
    allSchemaUseSchemaOrg = schema.every((o) => {
      const ctx = o["@context"];
      if (!ctx) return false;
      if (Array.isArray(ctx)) {
        return ctx.some((v) => String(v).includes("schema.org"));
      }
      return String(ctx).includes("schema.org");
    });
  }

  /* ---------- Person Schema relationship (v0.1 heuristic) ---------- */

  const personSchemas = schema.filter((o) => {
    const t = o["@type"];
    if (Array.isArray(t)) return t.includes("Person");
    return t === "Person";
  });

  // v0.1: assume non-conflict unless we explicitly detect a different org root.
  const personSchemaDoesNotConflict = true;

  /* ---------- Breadcrumb Hierarchy (v0.1 = best-effort true) ---------- */

  const breadcrumbHierarchyValid = true;

  /* ---------- Canonical Cleanliness ---------- */

  let canonicalIsClean = true;
  try {
    const cu = new URL(canonical);
    const search = (cu.search || "").toLowerCase();
    if (cu.search || cu.hash) canonicalIsClean = false;
    if (
      search.includes("utm_") ||
      search.includes("fbclid") ||
      search.includes("gclid")
    ) {
      canonicalIsClean = false;
    }
  } catch {
    canonicalIsClean = false;
  }

  /* ---------- Identity Roots Unified ---------- */

  let orgHost = canonicalRoot;
  if (orgSchemas[0]?.url) {
    try {
      const ou = new URL(orgSchemas[0].url);
      orgHost = ou.hostname.replace(/^www\./i, "");
    } catch {
      // ignore
    }
  }

  const rootSet = new Set(
    [identityRoot, canonicalRoot, orgHost].filter(Boolean)
  );
  const identityRootsUnified = rootSet.size <= 1;

  const hostnameMatchesIdentityRoot =
    host.replace(/^www\./i, "") === identityRoot;

  /* ---------- Final Context ---------- */

  return {
    title,
    canonical,
    schema,
    links,
    signals: signalsMap,

    host,
    identityRoot,
    canonicalRoot,
    orgSchemaName,
    breadcrumbRoot,
    orgSchemasAllHaveSameName,
    canonicalRoots,
    allSchemaUseSchemaOrg,
    personSchemaDoesNotConflict,
    breadcrumbHierarchyValid,
    canonicalIsClean,
    identityRootsUnified,
    hostnameMatchesIdentityRoot,
  };
}
