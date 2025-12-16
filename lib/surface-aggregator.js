// /lib/surface-aggregator.js
// EEI Surface Aggregator v1.1 (ARRAY-SAFE)
// Entity-level synthesis aligned with exmxc-crawl-worker output

export function aggregateSurfaces({ surfaces = [] }) {
  if (!Array.isArray(surfaces)) {
    throw new Error("surface-aggregator: surfaces must be an array");
  }

  let totals = {
    surfaceCount: surfaces.length,
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
    if (!surface || !surface.success) continue;

    const {
      surface: surfaceKey,
      title = "",
      canonicalHref = "",
      schemaObjects = [],
      crawlHealth = {}
    } = surface;

    surfaceSummaries[surface.url] = {
      title,
      canonical: canonicalHref,
      wordCount: crawlHealth.wordCount || 0,
      schemaCount: schemaObjects.length,
      internalLinkCount: crawlHealth.internalLinkCount || 0,
      externalLinkCount: crawlHealth.externalLinkCount || 0
    };

    // Totals
    totals.totalWords += crawlHealth.wordCount || 0;
    totals.totalSchemas += schemaObjects.length;
    totals.internalLinks += crawlHealth.internalLinkCount || 0;
    totals.externalLinks += crawlHealth.externalLinkCount || 0;

    if (title) totals.titles.push(title);
    if (canonicalHref) totals.canonicals.add(canonicalHref);

    for (const obj of schemaObjects) {
      if (obj?.["@type"]) {
        if (Array.isArray(obj["@type"])) {
          obj["@type"].forEach(t => totals.schemaTypes.add(t));
        } else {
          totals.schemaTypes.add(obj["@type"]);
        }
      }

      if (Array.isArray(obj?.sameAs)) {
        obj.sameAs.forEach(link => {
          try {
            totals.socialHosts.add(new URL(link).hostname);
          } catch {}
        });
      }
    }
  }

  const entitySignals = {
    surfaceCount: totals.surfaceCount,
    contentDepth: totals.totalWords,
    schemaCoverage: totals.totalSchemas,
    schemaDiversity: totals.schemaTypes.size,
    canonicalConsistency: totals.canonicals.size === 1,
    canonicalCount: totals.canonicals.size,
    internalLinkStrength:
      totals.internalLinks + totals.externalLinks > 0
        ? totals.internalLinks / (totals.internalLinks + totals.externalLinks)
        : 0,
    socialAuthorityCount: totals.socialHosts.size,
    titleConsistency:
      totals.titles.length > 1
        ? new Set(totals.titles).size / totals.titles.length
        : 1
  };

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
      multiSurface: true
    }
  };
}
