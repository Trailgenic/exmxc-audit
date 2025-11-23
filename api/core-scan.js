// /api/core-scan.js — EEI Crawl v2.5 (Minimal AI Crawl Upgrade)
// Unified Static + Rendered Crawl Engine with Normalized Signals
// Adds AI UA rotation, robots.txt acknowledgement, JSON-LD health,
// thin-content + schema sparsity signals, and AI confidence scoring.

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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exmxc-crawl/2.5 Safari/537.36",

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
   AI USER-AGENT ROTATION (GPTBot / ClaudeBot / Googlebot / exmxc)
   ============================================================ */

const AI_USER_AGENTS = [
  // Approx GPTBot UA
  "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
  // Approx ClaudeBot UA
  "ClaudeBot/1.0 (+https://www.anthropic.com/claudebot)",
  // Googlebot
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  // exmxc internal crawler
  "Mozilla/5.0 (compatible; exmxc-crawl/2.5; +https://exmxc.ai/eei)",
];

function getRandomAiUserAgent() {
  return AI_USER_AGENTS[Math.floor(Math.random() * AI_USER_AGENTS.length)];
}

/* ============================================================
   JSON-LD PARSER (clean variant + error stats)
   ============================================================ */
function parseJsonLd(ldTexts = []) {
  const nodes = [];

  let ldJsonCount = 0;
  let ldJsonValidCount = 0;
  let ldJsonErrorCount = 0;

  for (const raw of ldTexts) {
    if (!raw || typeof raw !== "string") continue;
    ldJsonCount++;

    let parsed;
    try {
      parsed = JSON.parse(raw);
      ldJsonValidCount++;
    } catch {
      ldJsonErrorCount++;
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

  return {
    schemaObjects: all,
    latestISO,
    schemaStats: {
      ldJsonCount,
      ldJsonValidCount,
      ldJsonErrorCount,
    },
  };
}

/* ============================================================
   robots.txt (acknowledgement only, no enforcement)
   ============================================================ */

async function fetchRobotsTxt(origin) {
  try {
    const robotsUrl = new URL("/robots.txt", origin).toString();
    const resp = await axios.get(robotsUrl, {
      timeout: 8000,
      maxRedirects: 2,
      headers: {
        "User-Agent": CRAWL_CONFIG.USER_AGENT,
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return resp.data || "";
  } catch {
    return null;
  }
}

function analyzeRobotsTxt(robotsTxt, url) {
  if (!robotsTxt) {
    return {
      checked: false,
      isDisallowedForGeneric: false,
      isDisallowedForGooglebot: false,
    };
  }

  const lines = robotsTxt.split(/\r?\n/);
  const parsed = [];
  let currentUA = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const uaMatch = line.match(/^user-agent:\s*(.+)$/i);
    if (uaMatch) {
      currentUA = uaMatch[1].toLowerCase();
      parsed.push({ ua: currentUA, disallow: [] });
      continue;
    }

    const disMatch = line.match(/^disallow:\s*(.*)$/i);
    if (disMatch && parsed.length > 0) {
      const path = disMatch[1].trim();
      parsed[parsed.length - 1].disallow.push(path);
    }
  }

  const { pathname } = new URL(url);

  function isDisallowedForAgent(targetUA) {
    let rules = parsed.filter((p) => p.ua === targetUA);
    if (rules.length === 0 && targetUA !== "*") {
      rules = parsed.filter((p) => p.ua === "*");
    }
    if (rules.length === 0) return false;

    for (const r of rules) {
      for (const path of r.disallow) {
        if (!path) continue; // empty disallow = allow all
        if (pathname.startsWith(path)) return true;
      }
    }
    return false;
  }

  return {
    checked: true,
    isDisallowedForGeneric: isDisallowedForAgent("*"),
    isDisallowedForGooglebot: isDisallowedForAgent("googlebot"),
  };
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

  const { schemaObjects, latestISO, schemaStats } = parseJsonLd(ldTexts);

  const rawLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  // Internal vs external link signals
  let internalLinks = 0;
  let externalLinks = 0;
  let totalLinks = rawLinks.length;
  let origin = null;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }

  for (const href of rawLinks) {
    try {
      const absolute = new URL(href, url).href;
      const linkOrigin = new URL(absolute).origin;
      if (origin && linkOrigin === origin) internalLinks++;
      else externalLinks++;
    } catch {
      // ignore malformed URLs
    }
  }

  const scriptTags = $("script");
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  const robotsMeta =
    $('meta[name="robots"]').attr("content") ||
    "";

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

    userAgentUsed: userAgent,

    diagnostics: {
      finalUrl: resp.request?.res?.responseUrl || url,
      htmlBytes: html.length,
      textBytes: bodyText.length,
      wordCount,
      domNodes: $("*").length,
      scriptCount: scriptTags.length,
      schemaScriptCount: ldTexts.length,
      imageCount: $("img").length,
      linkCount: rawLinks.length,
      internalLinkCount: internalLinks,
      externalLinkCount: externalLinks,
      internalLinkRatio:
        totalLinks > 0 ? internalLinks / totalLinks : 0,
      robots: robotsMeta,
      jsonLdCount: schemaStats.ldJsonCount,
      jsonLdValidCount: schemaStats.ldJsonValidCount,
      jsonLdErrorCount: schemaStats.ldJsonErrorCount,
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

    const { schemaObjects, latestISO, schemaStats } = parseJsonLd(ldTexts);

    const pageLinks =
      (await page.$$eval("a[href]", (nodes) =>
        nodes.map((n) => n.getAttribute("href")).filter(Boolean)
      )) || [];

    // For rendered we also compute basic diagnostics via cheerio
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const wordCount = bodyText ? bodyText.split(" ").length : 0;
    const robotsMeta =
      $('meta[name="robots"]').attr("content") ||
      "";

    let internalLinks = 0;
    let externalLinks = 0;
    let totalLinks = pageLinks.length;
    let origin = null;
    try {
      origin = new URL(url).origin;
    } catch {
      origin = null;
    }

    for (const href of pageLinks) {
      try {
        const absolute = new URL(href, url).href;
        const linkOrigin = new URL(absolute).origin;
        if (origin && linkOrigin === origin) internalLinks++;
        else externalLinks++;
      } catch {
        // ignore
      }
    }

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
      pageLinks,
      ldTexts,
      schemaObjects,
      latestISO,

      userAgentUsed: userAgent,

      diagnostics: {
        finalUrl: page.url(),
        htmlBytes: html.length,
        wordCount,
        scriptCount: await page.$$eval("script", (nodes) => nodes.length),
        schemaScriptCount: ldTexts.length,
        jsonLdCount: schemaStats.ldJsonCount,
        jsonLdValidCount: schemaStats.ldJsonValidCount,
        jsonLdErrorCount: schemaStats.ldJsonErrorCount,
        linkCount: totalLinks,
        internalLinkCount: internalLinks,
        externalLinkCount: externalLinks,
        internalLinkRatio:
          totalLinks > 0 ? internalLinks / totalLinks : 0,
        robots: robotsMeta,
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
   AI CONFIDENCE (Lite Mode)
   ============================================================ */
function computeAiConfidence(result, robotsSignals) {
  const d = result?.diagnostics || {};
  const schemaCount = Array.isArray(result?.schemaObjects)
    ? result.schemaObjects.length
    : 0;

  const robotsMeta = (d.robots || "").toLowerCase();
  const hasNoindex =
    robotsMeta.includes("noindex") || robotsMeta.includes("none");

  const wordCount = d.wordCount || 0;
  const scriptCount = d.scriptCount || 0;
  const jsonLdErrorCount = d.jsonLdErrorCount || 0;

  let score = 1.0;

  if (scriptCount > 60) score -= 0.15;
  if (schemaCount === 0) score -= 0.2;
  if (wordCount < 200) score -= 0.2;
  if (
    hasNoindex ||
    robotsSignals?.isDisallowedForGeneric ||
    robotsSignals?.isDisallowedForGooglebot
  ) {
    score -= 0.15;
  }
  if (jsonLdErrorCount > 0) score -= 0.1;

  if (score < 0) score = 0;

  let level = "high";
  if (score < 0.45) level = "low";
  else if (score < 0.75) level = "medium";

  return { score, level };
}

/* ============================================================
   PUBLIC — crawlPage()
   ============================================================ */
export async function crawlPage({
  url,
  mode = "rendered",
  timeoutMs = CRAWL_CONFIG.TIMEOUT_MS,
}) {
  let attempts = 0;

  // Minimal upgrade: we still *support* rendered,
  // but Vercel enforces static mode.
  if (CRAWL_CONFIG.IS_VERCEL && mode === "rendered") {
    mode = "static";
  }

  // Universal AI-style UA rotation
  const userAgent = getRandomAiUserAgent();

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

    // robots.txt acknowledgement (no blocking)
    let robotsSignals = {
      checked: false,
      isDisallowedForGeneric: false,
      isDisallowedForGooglebot: false,
    };
    try {
      const origin = new URL(url).origin;
      const robotsTxt = await fetchRobotsTxt(origin);
      robotsSignals = analyzeRobotsTxt(robotsTxt, url);
    } catch {
      // ignore robots errors
    }

    const diagnostics = {
      ...(result.diagnostics || {}),
      retryAttempts: attempts,
      robotsTxt: robotsSignals,
    };

    const health = computeCrawlHealth({ ...result, diagnostics });
    const aiConfidence = computeAiConfidence(
      { ...result, diagnostics },
      robotsSignals
    );

    return {
      ...result,
      mode,
      diagnostics: {
        ...diagnostics,
        aiConfidence,
      },
      crawlHealth: health,
      aiConfidence,
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
      aiConfidence: {
        score: 0,
        level: "low",
      },
    };
  }
}
