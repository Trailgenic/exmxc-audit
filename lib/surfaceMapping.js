// /lib/surfaceMapping.js — EEI v5.4 (Phase 4.2 Surface Mapping)
// Derives multi-surface "digital perimeter" from a single crawl snapshot.
//
// Input (from evaluateOntology):
//   deriveSurfaceMapping({ crawlData, baseCtx, identityCtx })
//
// Output:
//   {
//     surfaceCount,
//     surfaceRoots,
//     hasMultiSurfacePresence,
//     sameAsOverlapIndex,
//     sameAsOverlapStrong,
//     schemaRootsUnified,
//     canonicalConvergenceStrong,
//     multiSurfaceSchemaCoherent,
//     digitalPerimeterStable,
//     primaryRoots,
//     auxiliaryRoots,
//     aliasRoots,
//     identityCollisionRoots,
//     externalAuthorityRoots,
//     identityRootDomain,
//     perimeterConfidence,
//     notes
//   }

function normalizeHost(host) {
  if (!host) return null;
  return String(host).toLowerCase().replace(/^www\./i, "");
}

// Very light registrable-domain approximation: last 2 labels.
function getRootDomain(host) {
  if (!host) return null;
  const parts = String(host).split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

// Local copy of entity-root normalizer (avoids circular import)
function normalizeEntityRootToken(name) {
  if (!name || typeof name !== "string") return null;
  let s = name.toLowerCase();

  // Strip ™ / ®
  s = s.replace(/™|®/g, "");
  // Strip generic company suffixes
  s = s.replace(/\b(inc\.?|llc|corp\.?|corporation|company|co\.?)\b/g, "");
  // Collapse non-alphanumeric into dashes
  s = s.replace(/[^a-z0-9]+/g, "-");
  // Trim leading/trailing dashes
  s = s.replace(/^-+|-+$/g, "");

  return s || null;
}

function clamp(n, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n));
}

// Extract a coarse "brand token" from a root (e.g. "visa" from "visa.com")
function extractBrandTokenFromRoot(root) {
  if (!root) return null;
  const parts = String(root).split(".").filter(Boolean);
  if (parts.length === 0) return null;
  return parts[0]; // brand-ish portion, very light heuristic
}

export function deriveSurfaceMapping({ crawlData, baseCtx, identityCtx }) {
  const schemaBlocks = baseCtx.schema || [];
  const scoringOutputs = Array.isArray(crawlData?.scoringOutputs)
    ? crawlData.scoringOutputs
    : [];
  const surfaceMeta = crawlData?.surfaceMeta || {};

  const surfaceRootSet = new Set();
  const sameAsRootSet = new Set();
  const socialRootSet = new Set();
  const externalAuthorityRootSet = new Set();
  const metaRootSet = new Set();
  const notes = [];

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
      // ignore parse failures
    }
  };

  /* ---------------------------------------------
     1) Identity host / canonical roots
  --------------------------------------------- */
  const canonical = baseCtx.canonical || crawlData?.canonical || "";
  const url = crawlData?.url || canonical || "";
  const hostname =
    baseCtx.hostname ||
    crawlData?.hostname ||
    (url ? new URL(url).hostname : null);

  const hostNorm = normalizeHost(hostname);
  const identityRootDomain = getRootDomain(
    identityCtx.identityRoot || identityCtx.canonicalRoot || hostNorm
  );

  if (identityRootDomain) {
    surfaceRootSet.add(identityRootDomain);
  }

  // Track canonical "convergence" from identityCtx (single-URL for now)
  const canonicalConvergenceStrong =
    identityCtx.canonicalRoots && identityCtx.canonicalRoots.count === 1;

  /* ---------------------------------------------
     2) Schema-based surfaces (Organization / sameAs)
  --------------------------------------------- */
  const orgBlocks = schemaBlocks.filter((b) => b && b["@type"] === "Organization");

  // Organization.url / @id
  for (const org of orgBlocks) {
    if (typeof org.url === "string") {
      addUrlToSet(org.url, sameAsRootSet);
    }
    if (typeof org["@id"] === "string") {
      addUrlToSet(org["@id"], sameAsRootSet);
    }
  }

  // sameAs arrays
  for (const org of orgBlocks) {
    let sameAs = [];
    if (Array.isArray(org.sameAs)) {
      sameAs = org.sameAs;
    } else if (typeof org.sameAs === "string") {
      sameAs = [org.sameAs];
    }

    for (const urlStr of sameAs) {
      addUrlToSet(urlStr, sameAsRootSet);
    }
  }

  /* ---------------------------------------------
     3) Social + outbound signal surfaces
  --------------------------------------------- */
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
        const host = normalizeHost(h);
        const root = getRootDomain(host);
        if (!root) continue;

        // Treat only *non-identity* roots as external authorities
        if (identityRootDomain && root === identityRootDomain) continue;

        externalAuthorityRootSet.add(root);
        surfaceRootSet.add(root);
      }
    }
  }

  /* ---------------------------------------------
     4) Breadcrumb roots
  --------------------------------------------- */
  const breadcrumb = schemaBlocks.find((b) => b["@type"] === "BreadcrumbList");
  if (breadcrumb && Array.isArray(breadcrumb.itemListElement)) {
    for (const li of breadcrumb.itemListElement) {
      const itemUrl = li.item || li.url;
      addUrlToSet(itemUrl, metaRootSet);
    }
  }

  /* ---------------------------------------------
     5) Meta / link surfaces (og:url, alternates, icons, publisher)
  --------------------------------------------- */
  if (surfaceMeta.ogUrl) {
    addUrlToSet(surfaceMeta.ogUrl, metaRootSet);
  }

  if (Array.isArray(surfaceMeta.alternates)) {
    for (const href of surfaceMeta.alternates) {
      addUrlToSet(href, metaRootSet);
    }
  }

  if (Array.isArray(surfaceMeta.icons)) {
    for (const href of surfaceMeta.icons) {
      addUrlToSet(href, metaRootSet);
    }
  }

  if (Array.isArray(surfaceMeta.publisherUrls)) {
    for (const href of surfaceMeta.publisherUrls) {
      addUrlToSet(href, metaRootSet);
    }
  }

  /* ---------------------------------------------
     6) Schema-root unification (names → root token)
  --------------------------------------------- */
  const nameCandidates = [];

  if (identityCtx.entityName) nameCandidates.push(identityCtx.entityName);
  if (
    identityCtx.orgSchemaName &&
    identityCtx.orgSchemaName !== identityCtx.entityName
  ) {
    nameCandidates.push(identityCtx.orgSchemaName);
  }

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

  const rootTokens = new Set(
    nameCandidates
      .map((n) => normalizeEntityRootToken(n))
      .filter((v) => v && v.length > 0)
  );

  const schemaRootsUnified = rootTokens.size <= 1;

  /* ---------------------------------------------
     7) sameAs vs social overlap (root space)
  --------------------------------------------- */
  const sameAsRootList = Array.from(sameAsRootSet).filter(Boolean);
  const socialRootList = Array.from(socialRootSet).filter(Boolean);

  let sameAsOverlapIndex = null;
  let sameAsOverlapStrong = true; // default: "no signal = no penalty"

  if (sameAsRootList.length > 0 && socialRootList.length > 0) {
    const socialSet = new Set(socialRootList);
    let intersectionCount = 0;
    for (const r of sameAsRootList) {
      if (socialSet.has(r)) intersectionCount++;
    }
    const unionSet = new Set([...sameAsRootList, ...socialRootList]);
    sameAsOverlapIndex = unionSet.size > 0 ? intersectionCount / unionSet.size : 0;
    sameAsOverlapStrong = sameAsOverlapIndex >= 0.5;
  }

  /* ---------------------------------------------
     8) Surface roster + primary/auxiliary roots
  --------------------------------------------- */
  const surfaceRoots = Array.from(surfaceRootSet).filter(Boolean);
  const surfaceCount = surfaceRoots.length;
  const hasMultiSurfacePresence = surfaceCount > 1;

  const primaryRoots = [];
  if (identityRootDomain) {
    primaryRoots.push(identityRootDomain);
  } else if (surfaceRoots.length > 0) {
    primaryRoots.push(surfaceRoots[0]);
  }

  const auxiliaryRoots = surfaceRoots.filter((r) => !primaryRoots.includes(r));

  /* ---------------------------------------------
     9) Phase 4.2: Alias vs identity collisions
  --------------------------------------------- */
  const aliasRoots = [];
  const identityCollisionRoots = [];

  const identityBrandToken = extractBrandTokenFromRoot(identityRootDomain);

  for (const r of auxiliaryRoots) {
    const auxBrandToken = extractBrandTokenFromRoot(r);

    // If brand token matches, treat as alias surface (regional TLD, etc.)
    const isAlias =
      identityBrandToken && auxBrandToken && identityBrandToken === auxBrandToken;

    if (isAlias) {
      aliasRoots.push(r);
      continue;
    }

    // If it's a known external authority, don't treat as collision
    if (externalAuthorityRootSet.has(r)) {
      continue;
    }

    // Otherwise this is a true identity collision candidate
    identityCollisionRoots.push(r);
  }

  /* ---------------------------------------------
     10) Multi-surface schema coherence & perimeter stability
  --------------------------------------------- */
  const multiSurfaceSchemaCoherent =
    !hasMultiSurfacePresence || !!identityCtx.hasOrgOrPersonSchema;

  const digitalPerimeterStable = hasMultiSurfacePresence
    ? canonicalConvergenceStrong && schemaRootsUnified && sameAsOverlapStrong
    : true;

  // Perimeter confidence: soft, 0–1
  let perimeterConfidence = 1.0;

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

  if (hasMultiSurfacePresence && aliasRoots.length > 0) {
    // Aliases are expected; light confidence reduction only.
    perimeterConfidence *= 0.9;
    notes.push(
      `Alias surfaces detected for brand '${identityBrandToken}': ${aliasRoots.join(
        ", "
      )}`
    );
  }

  if (hasMultiSurfacePresence && identityCollisionRoots.length > 0) {
    perimeterConfidence *= 0.7;
    notes.push(
      `Multiple candidate identity roots detected: ${identityCollisionRoots.join(
        ", "
      )}`
    );
  }

  // If schema is completely missing, still mark that we are in fallback mode
  if (!schemaBlocks || schemaBlocks.length === 0) {
    notes.push("Schema not detected. Fallback perimeter activated.");
  }

  perimeterConfidence = clamp(perimeterConfidence, 0, 1);

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
    aliasRoots,
    identityCollisionRoots,
    externalAuthorityRoots: Array.from(externalAuthorityRootSet),
    identityRootDomain,
    perimeterConfidence,
    notes,
  };
}
