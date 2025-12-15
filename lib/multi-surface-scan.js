// /lib/multi-surface-scan.js
// EEI Multi-Surface Scan v1.0
// Identity-first | No ontology | AI-style comprehension sampling

import { discoverSurfaces } from "./surface-discovery.js";
import { crawlPage } from "../api/core-scan.js";

/* ============================================================
   CONFIG
   ============================================================ */

const DEFAULT_MODE = "static";

/* ============================================================
   MULTI-SURFACE SCAN
   ============================================================ */

export async function multiSurfaceScan({
  url,
  mode = DEFAULT_MODE
}) {
  const startedAt = Date.now();

  // 1️⃣ Discover identity surfaces
  const discovery = await discoverSurfaces(url);

  const surfaces = discovery.surfaceMap || {};
  const surfaceResults = {};
  const errors = [];

  // 2️⃣ Crawl each surface (sequential = safer, more realistic)
  for (const [surfaceKey, surfaceUrl] of Object.entries(surfaces)) {
    try {
      const result = await crawlPage({
        url: surfaceUrl,
        mode
      });

      surfaceResults[surfaceKey] = {
        surface: surfaceKey,
        url: surfaceUrl,
        result
      };
    } catch (err) {
      errors.push({
        surface: surfaceKey,
        url: surfaceUrl,
        error: err.message || "surface-crawl-failed"
      });
    }
  }

  // 3️⃣ Return unified response
  return {
    success: true,
    baseUrl: url,
    mode,
    surfacesDiscovered: Object.keys(surfaces),
    surfaceCount: Object.keys(surfaces).length,
    degradedDiscovery: discovery.degraded || false,

    surfaces: surfaceResults,
    errors,

    timing: {
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt
    }
  };
}
