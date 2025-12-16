// /lib/surface-aggregator.js
// EEI Surface Aggregator v2.0
// Contract-aligned with exmxc-crawl-worker (array-based surfaces, crawlHealth)

export function aggregateSurfaces({ surfaces = [] }) {
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

  for (const surface of surfaces) {
    if (!surface || surface.success === false) continue;

    const {
      url,
      title,
      canonicalHref,
      schemaObjects = [],
      crawlHealth = {}
    } = surface;

    const {
      wordCount = 0,
      internalLinkCount = 0,
      externalLinkCount = 0
    } = crawlHealth;

    // --- per-surface summary ---
    surfaceSummaries[url] = {
      title: title || "",
      canonical: canonicalHref || "",
      wordCount,
      schemaCount: schemaObjects.length,
      internalLinkCount,
      externalLinkCount
    };

    // --- totals ---
    totals.totalWords += wordCount;
    totals.totalSchemas += schemaObjects.length;
    totals.internalLinks += internalLinkCount;
    totals.externalLinks += externalLinkCount;

    if (title) totals.titles.push(title);
    if (canonicalHref) totals.canonicals.add(canonicalHref);

    for (const obj of schemaObjects) {
      const types = obj?.["@type"];
      if (types) {
        if (Array.isArray(types)) {
          types.forEach(t => totals.schemaTypes.add(t));
        } else {
          totals.schemaTypes.add(types);
        }
      }

      if (Array.isArray(obj?.sameAs)) {
        for (const link of obj.sameAs) {
          try {
            totals.socialHosts.add(new URL(link).hostname);
          } catch {}
        }
      }
    }
  }

  /* ============================================================
     ENTITY-LEVEL SIGNALS
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
     RETURN
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

    surfaceCoverage: totals.surfacesScanned,

    confidence: {
      avoidsOntology: true,
      aiComprehensionMode: true,
      multiSurface: true
    }
  };
}
