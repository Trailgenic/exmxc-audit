// /crawl/crawlMultiPage.js
// EEI v5.0 Multi-Page Crawl (Playwright)
// Depth=2, MaxPages=10

import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";

// Utility: Normalize + dedupe
function normalizeUrl(input) {
  try {
    let url = input.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const u = new URL(url);
    if (!u.pathname) u.pathname = "/";
    return u.toString();
  } catch {
    return null;
  }
}
function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

// Extract links from a rendered page
async function extractLinksFromPage(page, rootHost) {
  const hrefs = await page.$$eval("a[href]", (els) =>
    els.map((el) => el.getAttribute("href")).filter(Boolean)
  );

  // Normalize + dedupe
  const links = new Set();
  for (const href of hrefs) {
    try {
      const abs = new URL(href, page.url()).toString();
      const host = new URL(abs).hostname.replace(/^www\./i, "");
      if (host === rootHost) links.add(abs);
    } catch {
      // ignore
    }
  }
  return Array.from(links);
}

// Fetch + return minimal content from a single page
async function crawlPage(browser, url) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) exmxc-multipage/5.0",
  });

  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 20000,
    });

    const html = await page.content();
    const title = await page.title();

    let description = "";
    try {
      description = await page.$eval(
        'meta[name="description"]',
        (el) => el.content
      );
    } catch {
      // optional
    }

    return {
      success: true,
      url,
      title,
      description,
      htmlLength: html.length,
    };
  } catch (err) {
    return {
      success: false,
      url,
      error: err.message,
    };
  } finally {
    await page.close();
  }
}

/* =====================================================================================
   MAIN MULTI-PAGE CRAWL
   -------------------------------------------------------------------------------------
   rootUrl:    starting URL
   depth:      default 2
   maxPages:   default 10
   returns: {
     startUrl,
     pages [
       { url, title, description, htmlLength, success, error? }
     ]
   }
===================================================================================== */
export async function crawlMultiPage(
  rootUrl,
  { depth = 2, maxPages = 10 } = {}
) {
  const normalized = normalizeUrl(rootUrl);
  if (!normalized) throw new Error("Invalid root URL");

  const rootHost = hostnameOf(normalized);

  const executablePath = await chromium.executablePath;

  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });

  const visited = new Set();
  const queue = [{ url: normalized, d: 0 }];
  const results = [];

  try {
    while (queue.length && results.length < maxPages) {
      const { url, d } = queue.shift();
      if (visited.has(url)) continue;

      visited.add(url);

      const pageData = await crawlPage(browser, url);
      results.push(pageData);

      if (!pageData.success) continue;
      if (d >= depth) continue; // stop deeper

      // Extract next links
      try {
        const page = await browser.newPage();
        await page.goto(url, {
          waitUntil: "networkidle",
          timeout: 15000,
        });
        const links = await extractLinksFromPage(page, rootHost);
        await page.close();

        for (const next of links) {
          if (!visited.has(next) && results.length + queue.length < maxPages) {
            queue.push({ url: next, d: d + 1 });
          }
        }
      } catch {
        // ignore
      }
    }
  } finally {
    await browser.close();
  }

  return {
    success: true,
    startUrl: normalized,
    scannedPages: results.length,
    depth,
    maxPages,
    pages: results,
  };
}
