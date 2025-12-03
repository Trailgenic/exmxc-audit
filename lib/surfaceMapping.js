// /lib/surfaceMapping.js — EEI v5.4 (Phase 4 Surface Mapping — Informative)
// Always returns a structured perimeter object.
// If no schema is detected, compute a fallback digital perimeter
// based on URL, canonical, hostname, and identityCtx.
//
// Input:
//   deriveSurfaceMapping({ crawlData, baseCtx, identityCtx })
//
// Output always includes all perimeter fields.

function normalizeHost(host) {
  if (!host) return null;
  return String(host).toLowerCase().replace(/^www\./i, "");
}

// Light registrable-root approximation
function getRootDomain(host) {
  if (!host) return null;
  const parts = String(host).split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

function normalizeEntityRootToken(name) {
  if (!name || typeof name !== "string") return null;
  let s = name.toLowerCase();
  s = s.replace(/™|®/g, "");
  s = s.replace(
    /\b(inc\.?|llc|corp\.?|corporation|company|co\.?)\b/g,
    ""
  );
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s || null;
}

function clamp(n, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n));
}

/* ------------------------------------------------------------------
   Fallback constructor — used if no schema is present
------------------------------------------------------------------ */
function buildFallbackPerimeter({ crawlData, baseCtx, identityCtx }) {
  const notes = ["Schema not detected. Fallback perimeter activated."];

  // Best available URL references
  const canonical = baseCtx.canonical || crawlData?.canonical || "";
  const url = crawlData?.url || canonical || "";
  let hostname = null;

  try {
    hostname =
      baseCtx.hostname ||
      crawlData?.hostname ||
      (url ? new URL(url).hostname : null);
  } catch {
    hostname = null;
  }

  const hostNorm = normalizeHost(hostname);
  const rootDomain = getRootDomain(
    identityCtx.identityRoot ||
      identityCtx.canonicalRoot ||
      hostNorm
  );

  const surfaceRoots = [];
  if (rootDomain) surfaceRoots.push(rootDomain);

  return {
    surfaceCount: surfaceRoots.length,
    surfaceRoots,
    hasMultiSurfacePresence: false,
    sameAsOverlapIndex: null,
    sameAsOverlapStrong: true,
    schemaRootsUnified: true,
    canonicalConvergenceStrong: true,
    multiSurfaceSchemaCoherent: true,
    digitalPerimeterStable: true,
    primaryRoots: surfaceRoots.length ? [surfaceRoots[0]] : [],
    auxiliaryRoots: [],
    identityCollisionRoots: [],
    externalAuthorityRoots: [],
    identityRootDomain: rootDomain || null,
    perimeterConfidence: clamp(surfaceRoots.length ? 1 : 0.6), // neutral-safe
    notes,
  };
}

/* ------------------------------------------------------------------
   MAIN — deriveSurfaceMapping
------------------------------------------------------------------ */
export function deriveSurfaceMapping({ crawlData, baseCtx, identityCtx }) {
  const schemaBlocks = baseCtx.schema || [];
  const scoringOutputs = Array.isArray(crawlData?.scoringOutputs)
    ? crawlData.scoringOutputs
    : [];

  const surfaceMeta = crawlData?.surfaceMeta || {};
  const notes = [];

  /* --------------------------------------------------------------
      FALLBACK MODE — no schema
  -------------------------------------------------------------- */
  if (!schemaBlocks || schemaBlocks.length === 0) {
    return buildFallbackPerimeter({ crawlData, baseCtx, identityCtx });
  }

  /* --------------------------------------------------------------
      SCHEMA PRESENT — proceed with full original logic
  -------------------------------------------------------------- */

  const surfaceRootSet = new Set();
  const sameAsRootSet = new Set();
  const socialRootSet = new Set();
  const externalAuthorityRootSet = new Set();
  const metaRootSet = new Set();

  const addUrlToSet = (urlStr, targetSet) => {
    if (!urlStr) return;
    try {
      const base = crawlData?.url || baseCtx?.url || undefined;
      const u = new URL(urlStr, base);
      const hostNorm = normalizeHost(u.hostname);
      if (!hostNorm) return;
      const root = getRootDomain(hostNorm);
      if (!root) return;
      targetSet.add(root);
      surfaceRootSet.add(root);
    } catch {
      /* ignore bad URLs */
    }
  };

  // ----------------------------
  // 1) Identity host roots
  // ----------------------------
  const canonical = baseCtx.canonical || crawlData?.canonical || "";
  const url = crawlData?.url || canonical || "";

  let hostname = null;
  try {
    hostname =
      baseCtx.hostname ||
      crawlData?.hostname ||
      (url ? new URL(url).hostname : null);
  } catch {
    hostname = null;
  }

  const hostNorm = normalizeHost(hostname);
  const identityRootDomain = getRootDomain(
    identityCtx.identityRoot || identityCtx.canonicalRoot || hostNorm
  );

  if (identityRootDomain) {
    surfaceRootSet.add(identityRootDomain);
  }

  const canonicalConvergenceStrong =
    identityCtx.canonicalRoots && identityCtx.canonicalRoots.count === 1;

  // ----------------------------
  // 2) Organization schema + sameAs
  // ----------------------------
  const orgBlocks = schemaBlocks.filter(
    (b) => b && b["@type"] === "Organization"
  );

  for (const org of orgBlocks) {
    if (typeof org.url === "string") addUrlToSet(org.url, sameAsRootSet);
    if (typeof org["@id"] === "string") addUrlToSet(org["@id"], sameAsRootSet);

    let sameAs = [];
    if (Array.isArray(org.sameAs)) sameAs = org.sameAs;
    else if (typeof org.sameAs === "string") sameAs = [org.sameAs];

    for (const s of sameAs) addUrlToSet(s, sameAsRootSet);
  }

  // ----------------------------
  // 3) Social + outbound signals
  // ----------------------------
  for (const sig of scoringOutputs) {
    if (sig?.key === "Social Entity Links" && sig.raw) {
      const list = Array.isArray(sig.raw.distinctSocialHosts)
        ? sig.raw.distinctSocialHosts
        : [];
      for (const h of list) {
        const host = normalizeHost(h);
        const root = getRootDomain(host);
        if (root) {
          socialRootSet.add(root);
          surfaceRootSet.add(root);
        }
      }
    }

    if (sig?.key === "External Authority Signal" && sig.raw) {
      const list = Array.isArray(sig.raw.distinctOutboundHosts)
        ? sig.raw.distinctOutboundHosts
        : [];
      for (const h of list) {
        const root = getRootDomain(normalizeHost(h));
        if (root) {
          externalAuthorityRootSet.add(root);
          surfaceRootSet.add(root);
        }
      }
    }
  }

  // ----------------------------
  // 4) Breadcrumb roots
  // ----------------------------
  const breadcrumb = schemaBlocks.find(
    (b) => b["@type"] === "BreadcrumbList"
  );

  if (breadcrumb && Array.isArray(breadcrumb.itemListElement)) {
    for (const li of breadcrumb.itemListElement) {
      const itemUrl = li.item || li.url;
      addUrlToSet(itemUrl, metaRootSet);
    }
  }

  // ----------------------------
  // 5) Meta surfaces
  // ----------------------------
  if (surfaceMeta.ogUrl) addUrlToSet(surfaceMeta.ogUrl, metaRootSet);

  if (Array.isArray(surfaceMeta.alternates)) {
    for (const href of surfaceMeta.alternates) addUrlToSet(href, metaRootSet);
  }

  if (Array.isArray(surfaceMeta.icons)) {
    for (const href of surfaceMeta.icons) addUrlToSet(href, metaRootSet);
  }

  if (Array.isArray(surfaceMeta.publisherUrls)) {
    for (const href of surfaceMeta.publisherUrls) addUrlToSet(href, metaRootSet);
  }

  // ----------------------------
  // 6) Schema-root unification
  // ----------------------------
  const nameCandidates = [];

  if (identityCtx.entityName) nameCandidates.push(identityCtx.entityName);
  if (
    identityCtx.orgSchemaName &&
    identityCtx.orgSchemaName !== identityCtx.entityName
  ) {
    nameCandidates.push(identityCtx.orgSchemaName);
  }

  for (const org of orgBlocks) {
    if (typeof org.legalName === "string") nameCandidates.push(org.legalName);

    if (Array.isArray(org.alternateName)) {
      for (const alt of org.alternateName) {
        if (typeof alt === "string") nameCandidates.push(alt);
      }
    } else if (typeof org.alternateName === "string") {
      nameCandidates.push(org.alternateName);
    }
  }

  const rootTokens = new Set(
    nameCandidates
      .map((n) => normalizeEntityRootToken(n))
      .filter((v) => v && v.length > 0)
  );

  const schemaRootsUnified = rootTokens.size <= 1;

  // ----------------------------
  // 7) sameAs vs social overlap
  // ----------------------------
  const sameAsRootList = Array.from(sameAsRootSet).filter(Boolean);
  const socialRootList = Array.from(socialRootSet).filter(Boolean);

  let sameAsOverlapIndex = null;
  let sameAsOverlapStrong = true;

  if (sameAsRootList.length && socialRootList.length) {
    const socialSet = new Set(socialRootList);
    let intersectionCount = 0;

    for (const r of sameAsRootList) {
      if (socialSet.has(r)) intersectionCount++;
    }

    const union = new Set([...sameAsRootList, ...socialRootList]);
    sameAsOverlapIndex = union.size > 0 ? intersectionCount / union.size : 0;
    sameAsOverlapStrong = sameAsOverlapIndex >= 0.5;
  }

  // ----------------------------
  // 8) Surface roster
  // ----------------------------
  const surfaceRoots = Array.from(surfaceRootSet).filter(Boolean);
  const surfaceCount = surfaceRoots.length;
  const hasMultiSurfacePresence = surfaceCount > 1;

  const primaryRoots = [];
  if (identityRootDomain) primaryRoots.push(identityRootDomain);
  else if (surfaceRoots.length > 0) primaryRoots.push(surfaceRoots[0]);

  const auxiliaryRoots = surfaceRoots.filter(
    (r) => !primaryRoots.includes(r)
  );

  const identityCollisionRoots = auxiliaryRoots.filter(
    (r) => !externalAuthorityRootSet.has(r)
  );

  // ----------------------------
  // 9) Perimeter stability
  // ----------------------------
  const multiSurfaceSchemaCoherent =
    !hasMultiSurfacePresence || !!identityCtx.hasOrgOrPersonSchema;

  const digitalPerimeterStable = hasMultiSurfacePresence
    ? canonicalConvergenceStrong &&
      schemaRootsUnified &&
      sameAsOverlapStrong
    : true;

  // Confidence
  let perimeterConfidence = 1;

  if (!identityRootDomain) {
    perimeterConfidence *= 0.7;
    notes.push("No clear identity root domain detected.");
  }

  if (!canonicalConvergenceStrong) {
    perimeterConfidence *= 0.7;
    notes.push("Canonical roots do not converge cleanly.");
  }

  if (hasMultiSurfacePresence && !schemaRootsUnified) {
    perimeterConfidence *= 0.7;
    notes.push("Schema-level identity roots are not unified.");
  }

  if (hasMultiSurfacePresence && !sameAsOverlapStrong) {
    perimeterConfidence *= 0.8;
    notes.push("sameAs vs social host overlap is weak.");
  }

  if (hasMultiSurfacePresence && identityCollisionRoots.length > 0) {
    perimeterConfidence *= 0.7;
    notes.push(
      `Multiple candidate identity roots detected: ${identityCollisionRoots.join(
        ", "
      )}`
    );
  }

  perimeterConfidence = clamp(perimeterConfidence, 0, 1);

  // ----------------------------
  // RETURN (ALWAYS structured)
  // ----------------------------
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
    primaryRoots,
    auxiliaryRoots,
    identityCollisionRoots,
    externalAuthorityRoots: Array.from(externalAuthorityRootSet),
    identityRootDomain,
    perimeterConfidence,
    notes,
  };
}
