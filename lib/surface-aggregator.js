// /lib/surface-aggregator.js
// EEI Surface Aggregator v2.0 (ARRAY-NATIVE — FINAL)
// Entity-level signal synthesis
// Contract: surfaces MUST be an array of crawl results
// No ontology. No guessing. No reshaping upstream.

export function aggregateSurfaces({ surfaces }) {
  if (!Array.isArray(surfaces)) {
    throw new Error("surface-aggregator: surfaces must be an array");
  }

  /* ============================================================
     TOTAL ACCUMULATORS
     ============================================================ */

  const totals = {
    surfacesScanned: surfaces.length,
    totalWords: 0,
    totalSchemas: 0,
    internalLinks: 0,
    externalLinks: 0,
    schemaTypes: new Set(),
    titles: [],
    canonicals: new Set(),
    socialHosts: new Set()
  };

  const surfaceSummaries = {};

  /* ============================================================
     ITERATE SURFACES (ARRAY-NATIVE)
     ============================================================ */

  for (const surface of surfaces) {
    if (!surface || typeof surface !== "object") continue;

    const {
      surface: surfaceKey,
      url,
      title = "",
      canonicalHref = "",
      schemaObjects = [],
      diagnostics = {},
      pageLinks = []
    } = surface;

    const key = surfaceKey || url || `surface-${Object.keys(surfaceSummaries).length + 1}`;

    const wordCount = diagnostics.wordCount || 0;
    const internalLinkCount = diagnostics.internalLinkCount || 0;
    const externalLinkCount = diagnostics.externalLinkCount || 0;

    /* ---------- Surface summary ---------- */
    surfaceSummaries[key] = {
      title,
      canonical: canonicalHref,
      wordCount,
      schemaCount: schemaObjects.length,
      internalLinkCount,
      externalLinkCount
    };

    /* ---------- Totals ---------- */
    totals.totalWords += wordCount;
    totals.totalSchemas += schemaObjects.length;
    totals.internalLinks += internalLinkCount;
    totals.externalLinks += externalLinkCount;

    if (title) totals.titles.push(title);
    if (canonicalHref) totals.canonicals.add(canonicalHref);

    /* ---------- Schema aggregation ---------- */
    for (const obj of schemaObjects) {
      if (!obj || typeof obj !== "object") continue;

      const type = obj["@type"];
      if (type) {
        if (Array.isArray(type)) {
          type.forEach(t => totals.schemaTypes.add(t));
        } else {
          totals.schemaTypes.add(type);
        }
      }

      if (Array.isArray(obj.sameAs)) {
        for (const link of obj.sameAs) {
          try {
            totals.socialHosts.add(new URL(link).hostname);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  /* ============================================================
     ENTITY-LEVEL SIGNALS (DERIVED)
     ============================================================ */

  const entitySignals = {
    surfaceCount: totals.surfacesScanned,

    contentDepth: totals.totalWords,
    schemaCoverage: totals.totalSchemas,
    schemaDiversity: totals.schemaTypes.size,

    canonicalConsistency: totals.canonicals.size === 1,
    canonicalCount: totals.canonicals.size,

    internalLinkStrength:
      totals.internalLinks > 0
        ? totals.internalLinks / (totals.internalLinks + totals.externalLinks)
        : 0,

    socialAuthorityCount: totals.socialHosts.size,

    titleConsistency:
      totals.titles.length > 1
        ? new Set(totals.titles).size / totals.titles.length
        : 1
  };

  /* ============================================================
     RETURN (STABLE, CANONICAL SHAPE)
     ============================================================ */

  return {
    entitySummary: {
      surfaces: surfaceSummaries,
      totals: {
        totalWords: totals.totalWords,
        totalSchemas: totals.totalSchemas,
        schemaTypes: [...totals.schemaTypes],
        socialHosts: [...totals.socialHosts]
      }
    },

    entitySignals,

    confidence: {
      avoidsOntology: true,
      aiComprehensionMode: true,
      multiSurface: true,
      arrayNative: true
    }
  };
}
