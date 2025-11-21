// /api/core-scan.js — EEI Crawl v2.1 (Scaffolding Upgrade for 45% AI-Crawl Realism)

import axios from "axios";
import * as cheerio from "cheerio";

/* ===============================
   CRAWL CONFIG (Fortress v1.0)
   =============================== */
export const CRAWL_CONFIG = {
  USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (exmxc-ai-eei-crawler)",

  TIMEOUT_MS: 12000,
  RENDER_TIMEOUT_MS: 15000,
  NETWORK_IDLE_MS: 2000,

  RETRIES: 2,
  RETRY_DELAY_MS: 250,

  MAX_REDIRECTS: 5,

  RENDER_STRATEGY: "prefer-rendered",
  // prefer-rendered → rendered first, fallback to static
  // static-only     → skip Playwright
  // rendered-only   → no fallback

  COLLECT_LINK_COUNTS: true,
  COLLECT_SCRIPT_COUNTS: true,
  COLLECT_SCHEMA_BLOCKS: true,

  HTML_SIZE_LIMIT: 2_000_000, // ~2MB
};

/* ===============================
   HELPERS
   =============================== */

function isPlainObject(val) {
  return val && typeof val === "object" && !Array.isArray(val);
}

/** Sleep helper for retry logic */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =====================================================
   JSON-LD PARSER (unchanged from your existing version)
   ===================================================== */
function parseAndNormalizeJsonLd(ldTexts = []) {
  const allNodes = [];

  for (const txt of ldTexts) {
    if (!txt || typeof txt !== "string") continue;
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch {
      continue;
    }

    const pushNode = (node, rootCtx) => {
      if (!node || typeof node !== "object") return;
      if (rootCtx && !node["@context"]) {
        node["@context"] = rootCtx;
      }
      allNodes.push(node);
    };

    const handleParsed = (obj) => {
      if (!obj || typeof obj !== "object") return;
      const rootCtx = obj["@context"];

      if (Array.isArray(obj)) {
        obj.forEach((n) => pushNode(n, rootCtx));
      } else if (Array.isArray(obj["@graph"])) {
        obj["@graph"].forEach((n) => pushNode(n, rootCtx));
      } else {
        pushNode(obj, rootCtx);
      }
    };

    if (Array.isArray(parsed)) {
      parsed.forEach((node) => handleParsed(node));
    } else {
      handleParsed(parsed);
    }
  }

  // Merge by @id
  const byId = new Map();
  const loose = [];

  const deepMerge = (a, b) => {
    const result = { ...a };
    for (const [key, val] of Object.entries(b || {})) {
      if (val === undefined || val === null) continue;
      const existing = result[key];

      if (existing === undefined) {
        result[key] = val;
      } else if (Array.isArray(existing) && Array.isArray(val)) {
        result[key] = [...existing, ...val];
      } else if (isPlainObject(existing) && isPlainObject(val)) {
        result[key] = deepMerge(existing, val);
      } else {
        result[key] = val;
      }
    }
    return result;
  };

  for (const node of allNodes) {
    const id = node["@id"];
    if (id && typeof id === "string") {
      if (!byId.has(id)) {
        byId.set(id, { ...node });
      } else {
        const merged = deepMerge(byId.get(id), node);
        byId.set(id, merged);
      }
    } else {
      loose.push(node);
    }
  }

  const mergedNodes = [...byId.values(), ...loose];

  // Compute latestISO
  let latestISO = null;
  const dateKeys = [
    "dateModified",
    "dateUpdated",
    "datePublished",
    "uploadDate",
    "lastReviewed",
  ];

  for (const obj of mergedNodes) {
    if (!obj || typeof obj !== "object") continue;
    for (const key of dateKeys) {
      const raw = obj[key];
      if (!raw) continue;
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) {
        const iso = d.toISOString();
        if (!latestISO || d > new Date(latestISO)) {
          latestISO = iso;
        }
      }
    }
  }

  return { schemaObjects: mergedNodes, latestISO };
}

/* =====================================================
   STATIC CRAWL (unchanged logic, scaffolding added)
   ===================================================== */
async function staticCrawl({ url, timeoutMs, userAgent }) {
  const result = {
    _type: "static",
    html: "",
    status: null,
    title: "",
    description: "",
    canonicalHref: url.replace(/\/$/, ""),
    pageLinks: [],
    ldTexts: [],
    schemaObjects: [],
    latestISO: null,
  };

  const resp = await axios.get(url, {
    timeout: timeoutMs,
    maxRedirects: CRAWL_CONFIG.MAX_REDIRECTS,
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  result.status = resp.status || 200;
  result.html = resp.data || "";

  const $ = cheerio.load(result.html);

  result.title = ($("title").first().text() || "").trim();
  result.description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  result.canonicalHref =
    $('link[rel="canonical"]').attr("href") || url.replace(/\/$/, "");

  result.pageLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  result.ldTexts = $("script[type='application/ld+json']")
    .map((_, el) => $(el).contents().text())
    .get();

  const parsed = parseAndNormalizeJsonLd(result.ldTexts);
  result.schemaObjects = parsed.schemaObjects;
  result.latestISO = parsed.latestISO;

  return result;
}

/* =====================================================
   RENDERED CRAWL (unchanged logic, scaffolding added)
   ===================================================== */
async function renderedCrawl({ url, timeoutMs, userAgent }) {
  const result = {
    _type: "rendered",
    html: "",
    status: null,
    title: "",
    description: "",
    canonicalHref: url.replace(/\/$/, ""),
    pageLinks: [],
    ldTexts: [],
    schemaObjects: [],
    latestISO: null,
  };

  let chromium;
  try {
    const pw = await import("playwright-core");
    chromium = pw.chromium;
  } catch (err) {
    throw new Error(
      `Playwright not available: ${err.message || String(err)}`
    );
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ userAgent });

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });

    result.status = page.response()?.status() || 200;
    result.html = await page.content();

    result.title = ((await page.title()) || "").trim();
    result.description =
      (await page
        .$eval(
          'meta[name="description"], meta[property="og:description"]',
          (el) => el.getAttribute("content") || ""
        )
        .catch(() => "")) || "";

    result.canonicalHref =
      (await page
        .$eval('link[rel="canonical"]', (el) => el.getAttribute("href") || "")
        .catch(() => "")) || url.replace(/\/$/, "");

    result.pageLinks =
      (await page.$$eval("a[href]", (nodes) =>
        nodes.map((n) => n.getAttribute("href")).filter(Boolean)
      )) || [];

    result.ldTexts =
      (await page.$$eval(
        'script[type="application/ld+json"]',
        (nodes) => nodes.map((n) => n.textContent || "").filter(Boolean)
      )) || [];

    const parsed = parseAndNormalizeJsonLd(result.ldTexts);
    result.schemaObjects = parsed.schemaObjects;
    result.latestISO = parsed.latestISO;

    return result;
  } finally {
    await browser.close();
  }
}

/* =====================================================
   NORMALIZER — guaranteed consistent response
   ===================================================== */
function normalizeCrawlResult({
  url,
  mode,
  rendered,
  error,
  fallbackFromRendered,
  renderError,
  internalResult,
  diagnostics,
}) {
  const r = internalResult || {};

  return {
    url,
    mode,
    rendered,
    fallbackFromRendered: !!fallbackFromRendered,
    status: r.status || null,
    error: error || null,
    renderError: renderError || null,

    html: r.html || "",
    title: r.title || "",
    description: r.description || "",
    canonicalHref: r.canonicalHref || url.replace(/\/$/, ""),
    pageLinks: Array.isArray(r.pageLinks) ? r.pageLinks : [],
    schemaObjects: Array.isArray(r.schemaObjects) ? r.schemaObjects : [],
    latestISO: r.latestISO || null,

    // Future-proof container for phase A.2 (counts, block detection, redirect chain)
    diagnostics: diagnostics || {},
  };
}

/* =====================================================
   PUBLIC: crawlPage (scaffolding)
   ===================================================== */
export async function crawlPage({
  url,
  mode = "rendered",
  timeoutMs = CRAWL_CONFIG.TIMEOUT_MS,
  userAgent = CRAWL_CONFIG.USER_AGENT,
}) {
  let diagnostics = {};
  let internalResult = null;

  // ---- Static-only mode ----
  if (mode === "static" || CRAWL_CONFIG.RENDER_STRATEGY === "static-only") {
    try {
      internalResult = await staticCrawl({
        url,
        timeoutMs,
        userAgent,
      });
      return normalizeCrawlResult({
        url,
        mode: "static",
        rendered: false,
        internalResult,
        diagnostics,
      });
    } catch (err) {
      return normalizeCrawlResult({
        url,
        mode: "static",
        rendered: false,
        error: err?.message || "Static crawl failed",
        diagnostics,
      });
    }
  }

  // ---- Rendered-first strategy ----
  try {
    internalResult = await renderedCrawl({
      url,
      timeoutMs: CRAWL_CONFIG.RENDER_TIMEOUT_MS,
      userAgent,
    });

    return normalizeCrawlResult({
      url,
      mode: "rendered",
      rendered: true,
      internalResult,
      diagnostics,
    });
  } catch (renderErr) {
    // If rendered-only mode → no fallback
    if (CRAWL_CONFIG.RENDER_STRATEGY === "rendered-only") {
      return normalizeCrawlResult({
        url,
        mode: "rendered",
        rendered: false,
        error: renderErr?.message || "Rendered mode failed",
        renderError: renderErr?.message || null,
        diagnostics,
      });
    }

    // ---- Static fallback ----
    try {
      internalResult = await staticCrawl({
        url,
        timeoutMs,
        userAgent,
      });

      return normalizeCrawlResult({
        url,
        mode: "static",
        rendered: false,
        fallbackFromRendered: true,
        internalResult,
        renderError: renderErr?.message || null,
        diagnostics,
      });
    } catch (staticErr) {
      return normalizeCrawlResult({
        url,
        mode: "rendered",
        rendered: false,
        error:
          staticErr?.message ||
          `Rendered & static crawl both failed (${renderErr?.message || "rendered error"})`,
        renderError: renderErr?.message || null,
        diagnostics,
      });
    }
  }
}
