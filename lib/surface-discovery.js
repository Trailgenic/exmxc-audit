// /lib/surface-discovery.js
// EEI Multi-Surface Discovery v1.0
// Static-only | Deterministic | Identity-first
// Collects a bounded set of candidate identity surfaces.

import * as cheerio from "cheerio";
import { fetchPublicUrl, validateTarget } from "../shared/target-policy.js";

/* ============================================================
   CONFIG
   ============================================================ */

const SURFACE_PRIORITY = [
  { key: "about", patterns: ["/about", "/company", "/who-we-are"] },
  { key: "blog", patterns: ["/blog", "/news", "/insights", "/articles"] },
  { key: "investors", patterns: ["/investors", "/investor"] },
  { key: "careers", patterns: ["/careers", "/jobs"] },
  { key: "product", patterns: ["/product", "/products", "/menu", "/order"] }
];

const MAX_SURFACES = 4;
const TIMEOUT_MS = 15000;

const STATIC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-discovery/1.0 Safari/537.36";

/* ============================================================
   HELPERS
   ============================================================ */

function normalizeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function sameOrigin(urlA, urlB) {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

function matchSurface(href) {
  for (const surface of SURFACE_PRIORITY) {
    for (const pattern of surface.patterns) {
      if (href.includes(pattern)) {
        return surface.key;
      }
    }
  }
  return null;
}

/* ============================================================
   DISCOVERY ENGINE
   ============================================================ */

export async function discoverSurfaces(homeUrl) {
  const validated = validateTarget(homeUrl);
  if (!validated.ok) throw Object.assign(new Error(validated.error), { code: "ERR_INVALID_TARGET" });
  const surfaces = new Map();

  // Always include homepage
  const normalizedHome = validated.url.replace(/\/$/, "");
  surfaces.set("home", normalizedHome);

  let html = "";

  try {
    const resp = await fetchPublicUrl(validated.url, {
      timeoutMs: TIMEOUT_MS,
      maxRedirects: 5,
      userAgent: STATIC_UA
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
    html = resp.body;
  } catch {
    // If homepage fetch fails, return homepage only
    return {
      surfaces: Array.from(surfaces.values()),
      surfaceMap: Object.fromEntries(surfaces),
      degraded: true
    };
  }

  const $ = cheerio.load(html);

  const links = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  for (const rawHref of links) {
    if (surfaces.size >= MAX_SURFACES) break;

    const absolute = normalizeUrl(rawHref, validated.url);
    if (!absolute) continue;
    if (!sameOrigin(absolute, validated.url)) continue;

    const surfaceKey = matchSurface(absolute);
    if (!surfaceKey) continue;
    if (surfaces.has(surfaceKey)) continue;

    surfaces.set(surfaceKey, absolute);
  }

  return {
    surfaces: Array.from(surfaces.values()),
    surfaceMap: Object.fromEntries(surfaces),
    degraded: false
  };
}
