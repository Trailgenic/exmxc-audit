// /api/core-scan.js — EEI Crawl v2 (Rendered + Static Fallback + Schema Normalization)
import axios from "axios";
import * as cheerio from "cheerio";

/** Lightweight helper to detect plain objects */
function isPlainObject(val) {
  return val && typeof val === "object" && !Array.isArray(val);
}

/**
 * Parse and normalize JSON-LD blocks:
 * - Accepts an array of raw <script type="application/ld+json"> strings
 * - Parses JSON
 * - Flattens @graph containers
 * - Merges objects with the same @id
 */
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
      // inherit @context if missing but present at root
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

  // Compute latestISO from any date fields
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

/**
 * STATIC crawl: axios + cheerio.
 * Used for:
 *   - mode: 'static'
 *   - fallback when rendered mode fails
 */
async function staticCrawl({ url, timeoutMs, userAgent }) {
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    maxRedirects: 5,
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const status = resp.status || 200;
  const html = resp.data || "";
  const $ = cheerio.load(html);

  const title = ($("title").first().text() || "").trim();
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  const canonicalHref =
    $('link[rel="canonical"]').attr("href") || url.replace(/\/$/, "");

  const pageLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const ldTexts = $("script[type='application/ld+json']")
    .map((_, el) => $(el).contents().text())
    .get();

  const { schemaObjects, latestISO } = parseAndNormalizeJsonLd(ldTexts);

  return {
    mode: "static",
    rendered: false,
    status,
    html,
    title,
    description,
    canonicalHref,
    pageLinks,
    schemaObjects,
    latestISO,
    renderError: null,
    fallbackFromRendered: false,
  };
}

/**
 * RENDERED crawl: Playwright-based (AI-like DOM, JS executed).
 * If anything fails (import, launch, navigation, etc.), caller can fallback.
 */
async function renderedCrawl({ url, timeoutMs, userAgent }) {
  let chromium;
  try {
    // dynamic import so project can run without Playwright during setup
    const pw = await import("playwright-core");
    chromium = pw.chromium;
  } catch (err) {
    throw new Error(
      `Playwright not available (install 'playwright-core'): ${err.message || String(
        err
      )}`
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent,
    });

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });

    const status = page.response()?.status() || 200;
    const html = await page.content();

    const title = (await page.title()) || "";
    const description =
      (await page
        .$eval(
          'meta[name="description"], meta[property="og:description"]',
          (el) => el.getAttribute("content") || ""
        )
        .catch(() => "")) || "";

    const canonicalHref =
      (await page
        .$eval('link[rel="canonical"]', (el) => el.getAttribute("href") || "")
        .catch(() => "")) || url.replace(/\/$/, "");

    const pageLinks =
      (await page.$$eval("a[href]", (nodes) =>
        nodes
          .map((n) => n.getAttribute("href"))
          .filter(Boolean)
      )) || [];

    const ldTexts =
      (await page.$$eval(
        'script[type="application/ld+json"]',
        (nodes) =>
          nodes.map((n) => n.textContent || n.innerText || "").filter(Boolean)
      )) || [];

    const { schemaObjects, latestISO } = parseAndNormalizeJsonLd(ldTexts);

    return {
      mode: "rendered",
      rendered: true,
      status,
      html,
      title: title.trim(),
      description: description.trim(),
      canonicalHref,
      pageLinks,
      schemaObjects,
      latestISO,
      renderError: null,
      fallbackFromRendered: false,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Public API: crawlPage
 *
 * - Tries rendered mode first (if requested)
 * - Falls back to static crawl if rendered fails
 * - Always returns a normalized object for audit.js
 */
export async function crawlPage({
  url,
  mode = "rendered",
  timeoutMs = 20000,
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-crawl/2.0 Safari/537.36",
}) {
  const baseResult = {
    url,
    mode,
    rendered: false,
    status: null,
    html: "",
    title: "",
    description: "",
    canonicalHref: url.replace(/\/$/, ""),
    pageLinks: [],
    schemaObjects: [],
    latestISO: null,
    error: null,
    renderError: null,
    fallbackFromRendered: false,
  };

  // If explicit static mode requested → no rendered attempt
  if (mode === "static") {
    try {
      const staticResult = await staticCrawl({ url, timeoutMs, userAgent });
      return { ...baseResult, ...staticResult, mode: "static" };
    } catch (err) {
      return {
        ...baseResult,
        mode: "static",
        error:
          err?.message ||
          "Static crawl failed (network, timeout, or blocked request)",
      };
    }
  }

  // Default: rendered-first with static fallback
  try {
    const renderedResult = await renderedCrawl({ url, timeoutMs, userAgent });
    return { ...baseResult, ...renderedResult, mode: "rendered" };
  } catch (renderErr) {
    // fallback to static
    let staticResult;
    try {
      staticResult = await staticCrawl({ url, timeoutMs, userAgent });
      return {
        ...baseResult,
        ...staticResult,
        mode: "static",
        rendered: false,
        fallbackFromRendered: true,
        renderError:
          renderErr?.message || "Rendered crawl failed; using static mode",
      };
    } catch (staticErr) {
      return {
        ...baseResult,
        mode: "rendered",
        error:
          staticErr?.message ||
          `Rendered and static crawls both failed (${renderErr?.message || "rendered error"})`,
        renderError: renderErr?.message || null,
      };
    }
  }
}

