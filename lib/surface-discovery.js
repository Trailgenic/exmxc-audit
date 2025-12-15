// /lib/surface-discovery.js
// EEI Multi-Surface Discovery v1.0
// Static-only | Deterministic | Identity-first
// Designed to simulate AI surface sampling (not SEO crawling)

import axios from "axios";
import * as cheerio from "cheerio";

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
  const surfaces = new Map();

  // Always include homepage
  const normalizedHome = homeUrl.replace(/\/$/, "");
  surfaces.set("home", normalizedHome);

  let html = "";

  try {
    const resp = await axios.get(homeUrl, {
      timeout: TIMEOUT_MS,
      maxRedirects: 5,
      headers: {
        "User-Agent": STATIC_UA,
        Accept: "text/html"
      },
      validateStatus: (s) => s >= 200 && s < 400
    });

    html = typeof resp.data === "string" ? resp.data : "";
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

    const absolute = normalizeUrl(rawHref, homeUrl);
    if (!absolute) continue;
    if (!sameOrigin(absolute, homeUrl)) continue;

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
