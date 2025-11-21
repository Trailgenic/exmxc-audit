// /api/core-scan.js — EEI Crawl v2.4 (Option B Clean Rebuild)
// Unified Static + Rendered Crawl Engine with Normalized Signals
// Clean diagnostics, stable schema parsing, crawlHealth pipeline preserved

import axios from "axios";
import * as cheerio from "cheerio";

/* ============================================================
   0. GLOBAL CONFIG
   ============================================================ */
export const CRAWL_CONFIG = {
  TIMEOUT_MS: 20000,
  MAX_REDIRECTS: 5,
  RETRIES: 1,
  RETRY_DELAY_MS: 300,
  USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-crawl/2.4 Safari/537.36",

  IS_VERCEL:
    !!process.env.VERCEL ||
    !!process.env.NOW_REGION ||
    !!process.env.VERCEL_ENV,
};

/* ============================================================
   HELPERS
   ============================================================ */
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function classifyError(err) {
  if (!err) return "unknown-error";
  const msg = err.message || String(err);
  if (/timeout/i.test(msg)) return "timeout";
  if (/network/i.test(msg)) return "network-error";
  if (/ECONNREFUSED/i.test(msg)) return "network-error";
  if (/navigation timeout/i.test(msg)) return "timeout";
  if (/blocked/i.test(msg)) return "blocked";
  if (/rate limit/i.test(msg)) return "blocked-rate-limit";
  return "unknown-error";
}

/* ============================================================
   JSON-LD PARSER (clean variant)
   ============================================================ */
function parseJsonLd(ldTexts = []) {
  const nodes = [];

  for (const raw of ldTexts) {
    if (!raw || typeof raw !== "string") continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const push = (obj, ctx) => {
      if (obj && typeof obj === "object") {
        if (ctx && !obj["@context"]) obj["@context"] = ctx;
        nodes.push(obj);
      }
    };

    const handle = (obj) => {
      if (!obj) return;
      const ctx = obj["@context"];
      if (Array.isArray(obj)) obj.forEach((n) => push(n, ctx));
      else if (Array.isArray(obj["@graph"]))
        obj["@graph"].forEach((n) => push(n, ctx));
      else push(obj, ctx);
    };

    Array.isArray(parsed) ? parsed.forEach(handle) : handle(parsed);
  }

  // Merge by @id
  const byId = new Map();
  const loose = [];

  const deepMerge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(out[k]) && Array.isArray(v)) out[k] = [...out[k], ...v];
      else if (isPlainObject(out[k]) && isPlainObject(v))
        out[k] = deepMerge(out[k], v);
      else out[k] = v;
    }
    return out;
  };

  for (const n of nodes) {
    const id = n["@id"];
    if (id) {
      if (!byId.has(id)) byId.set(id, n);
      else byId.set(id, deepMerge(byId.get(id), n));
    } else loose.push(n);
  }

  const all = [...byId.values(), ...loose];

  // Extract latest date
  const dateKeys = [
    "dateModified",
    "dateUpdated",
    "datePublished",
    "uploadDate",
    "lastReviewed",
  ];
  let latestISO = null;

  for (const obj of all) {
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

  return { schemaObjects: all, latestISO };
}

/* ============================================================
   STATIC CRAWL
   ============================================================ */
async function staticCrawl(url, timeoutMs, userAgent) {
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    maxRedirects: CRAWL_CONFIG.MAX_REDIRECTS,
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const html = resp.data || "";
  const $ = cheerio.load(html);

  const ldTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get();

  const { schemaObjects, latestISO } = parseJsonLd(ldTexts);

  const rawLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const scriptTags = $("script");
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  return {
    _type: "static",
    status: resp.status,
    html,
    title: $("title").first().text().trim(),
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",
    canonicalHref:
      $('link[rel="canonical"]').attr("href") || url.replace(/\/$/, ""),
    pageLinks: rawLinks,
    ldTexts,
    schemaObjects,
    latestISO,

    diagnostics: {
      finalUrl: resp.request?.res?.responseUrl || url,
      htmlBytes: html.length,
      textBytes: bodyText.length,
      wordCount: bodyText ? bodyText.split(" ").length : 0,
      domNodes: $("*").length,
      scriptCount: scriptTags.length,
      schemaScriptCount: ldTexts.length,
      imageCount: $("img").length,
      linkCount: rawLinks.length,
      robots:
        $('meta[name="robots"]').attr("content") ||
        "",
    },
  };
}

/* ============================================================
   RENDERED CRAWL
   ============================================================ */
async function renderedCrawl(url, timeoutMs, userAgent) {
  let chromium;
  try {
    chromium = (await import("playwright-core")).chromium;
  } catch (err) {
    throw new Error("Playwright unavailable: " + err.message);
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ userAgent });
    await page.goto(url, { timeout: timeoutMs, waitUntil: "networkidle" });

    const html = await page.content();
    const ldTexts = await page.$$eval(
      'script[type="application/ld+json"]',
      (nodes) => nodes.map((n) => n.textContent || "").filter(Boolean)
    );

    const { schemaObjects, latestISO } = parseJsonLd(ldTexts);

    return {
      _type: "rendered",
      status: page.response()?.status() || 200,
      html,
      title: (await page.title()) || "",
      description:
        (await page
          .$eval(
            'meta[name="description"], meta[property="og:description"]',
            (el) => el.getAttribute("content") || ""
          )
          .catch(() => "")) || "",
      canonicalHref:
        (await page
          .$eval('link[rel="canonical"]', (el) => el.getAttribute("href") || "")
          .catch(() => "")) || url.replace(/\/$/, ""),
      pageLinks:
        (await page.$$eval("a[href]", (nodes) =>
          nodes.map((n) => n.getAttribute("href")).filter(Boolean)
        )) || [],

      ldTexts,
      schemaObjects,
      latestISO,

      diagnostics: {
        finalUrl: page.url(),
        htmlBytes: html.length,
        scriptCount: await page.$$eval("script", (nodes) => nodes.length),
        jsonLdCount: ldTexts.length,
      },
    };
  } finally {
    await browser.close();
  }
}

/* ============================================================
   CRAWL HEALTH (same logic, cleaner structure)
   ============================================================ */
function computeCrawlHealth(result) {
  const status = result?.status ?? null;
  const d = result?.diagnostics || {};
  const schemaCount = Array.isArray(result?.schemaObjects)
    ? result.schemaObjects.length
    : 0;

  const flags = {
    isOk: false,
    isBlocked: false,
    isThinContent: false,
    isJsHeavy: false,
    isSchemaSparse: false,
  };

  const notes = [];
  let category = "ok";
  let score = 100;

  if (status >= 500) {
    category = "server-error";
    flags.isBlocked = true;
    score = 10;
    notes.push("5xx server error.");
  } else if (status >= 400) {
    category = "client-error";
    flags.isBlocked = true;
    score = 20;
    notes.push("4xx client error.");
  }

  const robots = (d.robots || "").toLowerCase();
  if (robots.includes("noindex") || robots.includes("nofollow")) {
    flags.isBlocked = true;
    category = "robots-blocked";
    score = Math.min(score, 30);
    notes.push(`Robots meta tag blocks indexing: "${robots}".`);
  }

  if (d.wordCount && d.wordCount < 200) {
    flags.isThinContent = true;
    category = category === "ok" ? "thin-content" : category;
    score = Math.min(score, 60);
    notes.push(`Thin content (word count ${d.wordCount}).`);
  }

  if (d.scriptCount > 60) {
    flags.isJsHeavy = true;
    category = category === "ok" ? "js-heavy" : category;
    score = Math.min(score, 55);
    notes.push(`Heavy JavaScript (${d.scriptCount} scripts).`);
  }

  if (schemaCount === 0) {
    flags.isSchemaSparse = true;
    if (category === "ok") category = "schema-sparse";
    score = Math.min(score, 65);
    notes.push("No JSON-LD schema.");
  }

  if (
    !flags.isBlocked &&
    !flags.isThinContent &&
    !flags.isJsHeavy &&
    !flags.isSchemaSparse &&
    status >= 200 &&
    status < 400
  ) {
    flags.isOk = true;
    notes.push("Healthy crawl.");
  }

  return {
    status,
    category,
    score: Math.max(0, Math.min(100, score)),
    flags,
    notes,
  };
}

/* ============================================================
   PUBLIC — crawlPage()
   ============================================================ */
export async function crawlPage({
  url,
  mode = "rendered",
  timeoutMs = CRAWL_CONFIG.TIMEOUT_MS,
  userAgent = CRAWL_CONFIG.USER_AGENT,
}) {
  let attempts = 0;

  if (CRAWL_CONFIG.IS_VERCEL && mode === "rendered") {
    mode = "static";
  }

  const tryOnce = async () => {
    try {
      return mode === "static"
        ? await staticCrawl(url, timeoutMs, userAgent)
        : await renderedCrawl(url, timeoutMs, userAgent);
    } catch (err) {
      if (attempts < CRAWL_CONFIG.RETRIES) {
        attempts++;
        await sleep(CRAWL_CONFIG.RETRY_DELAY_MS);
        return tryOnce();
      }
      throw err;
    }
  };

  try {
    const result = await tryOnce();
    const health = computeCrawlHealth(result);

    return {
      ...result,
      mode,
      diagnostics: {
        ...(result.diagnostics || {}),
        retryAttempts: attempts,
      },
      crawlHealth: health,
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
      error: err.message || "Crawl failed",
      diagnostics: {
        retryAttempts: attempts,
        errorType: classifyError(err),
      },
      crawlHealth: {
        status: null,
        category: "error",
        score: 0,
        flags: {
          isOk: false,
          isBlocked: false,
          isThinContent: false,
          isJsHeavy: false,
          isSchemaSparse: false,
        },
        notes: ["Crawl failed."],
      },
    };
  }
}
