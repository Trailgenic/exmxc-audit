// /api/core-scan.js — EEI Crawl v2.1 (Rendered + Static Fallback + Schema Normalization + Diagnostics)
import axios from "axios";
import * as cheerio from "cheerio";

/* ============================================================
   0. HELPERS
   ============================================================ */

function isPlainObject(val) {
  return val && typeof val === "object" && !Array.isArray(val);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function classifyError(err) {
  if (!err) return "unknown-error";
  const msg = err.message || String(err);

  if (/timeout/i.test(msg)) return "timeout";
  if (/network/i.test(msg)) return "network-error";
  if (/ECONNREFUSED/i.test(msg)) return "network-error";
  if (/navigation timeout/i.test(msg)) return "timeout";
  if (/blocked/i.test(msg)) return "blocked";
  if (/net::/i.test(msg)) return "network-error";
  if (/rate limit/i.test(msg)) return "blocked-rate-limit";

  return "unknown-error";
}

function countLinks(pageLinks, originHost) {
  let internal = 0,
    external = 0;

  for (const href of pageLinks || []) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./, "");
      if (host === originHost) internal++;
      else external++;
    } catch {}
  }

  const total = internal + external;
  return { internal, external, ratio: total ? internal / total : 0 };
}

/* ============================================================
   1. JSON-LD PARSER + NORMALIZER
   ============================================================ */

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
      if (rootCtx && !node["@context"]) node["@context"] = rootCtx;
      allNodes.push(node);
    };

    const handle = (obj) => {
      if (!obj || typeof obj !== "object") return;
      const rootCtx = obj["@context"];
      if (Array.isArray(obj)) obj.forEach((n) => pushNode(n, rootCtx));
      else if (Array.isArray(obj["@graph"]))
        obj["@graph"].forEach((n) => pushNode(n, rootCtx));
      else pushNode(obj, rootCtx);
    };

    Array.isArray(parsed) ? parsed.forEach(handle) : handle(parsed);
  }

  // Merge by @id
  const byId = new Map();
  const loose = [];

  const deepMerge = (a, b) => {
    const result = { ...a };
    for (const [key, val] of Object.entries(b || {})) {
      if (val === undefined || val === null) continue;
      const existing = result[key];

      if (existing === undefined) result[key] = val;
      else if (Array.isArray(existing) && Array.isArray(val))
        result[key] = [...existing, ...val];
      else if (isPlainObject(existing) && isPlainObject(val))
        result[key] = deepMerge(existing, val);
      else result[key] = val;
    }
    return result;
  };

  for (const node of allNodes) {
    const id = node["@id"];
    if (id) {
      if (!byId.has(id)) byId.set(id, { ...node });
      else byId.set(id, deepMerge(byId.get(id), node));
    } else loose.push(node);
  }

  const merged = [...byId.values(), ...loose];

  // compute latestISO
  let latestISO = null;
  const dateKeys = [
    "dateModified",
    "dateUpdated",
    "datePublished",
    "uploadDate",
    "lastReviewed",
  ];

  for (const obj of merged) {
    if (!obj || typeof obj !== "object") continue;
    for (const key of dateKeys) {
      const raw = obj[key];
      if (!raw) continue;
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) {
        const iso = d.toISOString();
        if (!latestISO || d > new Date(latestISO)) latestISO = iso;
      }
    }
  }

  return { schemaObjects: merged, latestISO };
}

/* ============================================================
   2. STATIC CRAWL
   ============================================================ */

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
    _type: "static",
    status: resp.status,
    html,
    title,
    description,
    canonicalHref,
    pageLinks,
    ldTexts,
    schemaObjects,
    latestISO,

    diagnostics: {
      redirectCount: resp.request?.res?.redirects?.length || 0,
      finalUrl: resp.request?.res?.responseUrl || url,
      htmlSize: html.length || 0,
      scriptCount: $("script").length,
      jsonLdCount: ldTexts.length,
    },
  };
}

/* ============================================================
   3. RENDERED CRAWL
   ============================================================ */

async function renderedCrawl({ url, timeoutMs, userAgent }) {
  let chromium;
  try {
    const pw = await import("playwright-core");
    chromium = pw.chromium;
  } catch (err) {
    throw new Error(
      `Playwright not available (install 'playwright-core'): ${err.message}`
    );
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ userAgent });
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });

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
      _type: "rendered",
      status,
      html,
      title: title.trim(),
      description: description.trim(),
      canonicalHref,
      pageLinks,
      ldTexts,
      schemaObjects,
      latestISO,

      diagnostics: {
        finalUrl: page.url(),
        htmlSize: html.length || 0,
        scriptCount: await page.$$eval("script", (nodes) => nodes.length).catch(() => 0),
        jsonLdCount: ldTexts.length,
      },
    };
  } finally {
    await browser.close();
  }
}

/* ============================================================
   4. PUBLIC: crawlPage()
   ============================================================ */

export async function crawlPage({
  url,
  mode = "rendered",
  timeoutMs = 20000,
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-crawl/2.1 Safari/537.36",
}) {
  let retryAttempts = 0;
  const maxRetries = 0; // Phase A.3 will activate retries.

  const diagnostics = {};

  const attempt = async () => {
    try {
      if (mode === "static")
        return await staticCrawl({ url, timeoutMs, userAgent });
      return await renderedCrawl({ url, timeoutMs, userAgent });
    } catch (err) {
      diagnostics.errorType = classifyError(err);
      if (retryAttempts < maxRetries) {
        retryAttempts++;
        await sleep(300);
        return await attempt();
      }
      throw err;
    }
  };

  try {
    const result = await attempt();

    // Integrate error diagnostics metadata
    return {
      ...result,
      diagnostics: {
        ...(result.diagnostics || {}),
        retryAttempts,
        errorType: diagnostics.errorType || null,
      },
    };
  } catch (err) {
    return {
      _type: mode,
      status: null,
      html: "",
      title: "",
      description: "",
      canonicalHref: url.replace(/\/$/, ""),
      pageLinks: [],
      ldTexts: [],
      schemaObjects: [],
      latestISO: null,
      diagnostics: {
        retryAttempts,
        errorType: classifyError(err),
      },
      error: err.message || "Crawl failed",
    };
  }
}
