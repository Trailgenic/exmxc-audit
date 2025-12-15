// /lib/surface-aggregator.js
// EEI Surface Aggregator v1.0
// Entity-level signal synthesis (no ontology)

export function aggregateSurfaces(multiSurfaceResult) {
  const surfaces = multiSurfaceResult.surfaces || {};

  const surfaceKeys = Object.keys(surfaces);

  let totals = {
    surfacesScanned: surfaceKeys.length,
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

  for (const key of surfaceKeys) {
    const r = surfaces[key]?.result;
    if (!r) continue;

    const d = r.diagnostics || {};

    // --- surface summary (kept lightweight) ---
    surfaceSummaries[key] = {
      title: r.title || "",
      canonical: r.canonicalHref || "",
      wordCount: d.wordCount || 0,
      schemaCount: r.schemaObjects?.length || 0,
      internalLinkCount: d.internalLinkCount || 0,
      externalLinkCount: d.externalLinkCount || 0
    };

    // --- aggregation ---
    totals.totalWords += d.wordCount || 0;
    totals.totalSchemas += r.schemaObjects?.length || 0;
    totals.internalLinks += d.internalLinkCount || 0;
    totals.externalLinks += d.externalLinkCount || 0;

    if (r.title) totals.titles.push(r.title);
    if (r.canonicalHref) totals.canonicals.add(r.canonicalHref);

    for (const obj of r.schemaObjects || []) {
      if (obj["@type"]) {
        if (Array.isArray(obj["@type"])) {
          obj["@type"].forEach(t => totals.schemaTypes.add(t));
        } else {
          totals.schemaTypes.add(obj["@type"]);
        }
      }

      if (obj.sameAs) {
        obj.sameAs.forEach(link => {
          try {
            totals.socialHosts.add(new URL(link).hostname);
          } catch {}
        });
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

    confidence: {
      avoidsOntology: true,
      aiComprehensionMode: true,
      multiSurface: true
    }
  };
}
