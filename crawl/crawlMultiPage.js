// =============================================
// crawlMultiPage.js  (Playwright Multi-Page MVP)
// exmxc.ai — Multi-Page Crawl Module
// =============================================

import { chromium } from "playwright";

/**
 * Crawl up to N internal pages beginning from home URL.
 * Return page-level signal snapshots + simple averages.
 *
 * MVP Strategy:
 * 1. open home page via Playwright
 * 2. discover internal links
 * 3. pick the first N (exclude home)
 * 4. render each page with Playwright
 * 5. extract minimal signals
 * 6. aggregate & return
 */

export async function crawlMultiPage(homeUrl, maxPages = 3) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const result = {
    pages: [],
    avg: {
      titles: 0,
      descriptions: 0,
      canonicalConsistency: 0,
      wordCount: 0,
    },
    entityDrift: 0, // simple early placeholder
  };

  try {
    // ------------------------------------------
    // Load home page
    // ------------------------------------------
    await page.goto(homeUrl, {
      waitUntil: "networkidle",
      timeout: 45000,
    });

    // ------------------------------------------
    // Discover links on the home page
    // ------------------------------------------
    const links = await page.$$eval("a[href]", (as) => {
      return as
        .map((a) => a.href)
        .filter((x) => typeof x === "string" && x.trim().length > 0);
    });

    // Normalize origin for internal check
    const origin = new URL(homeUrl).origin;

    // Filter internal pages
    const internal = links
      .filter((url) => url.startsWith(origin))
      .filter((url) => url !== homeUrl);

    // De-duplicate
    const unique = [...new Set(internal)];

    // Limit to maxPages
    const targets = unique.slice(0, maxPages);

    // ------------------------------------------
    // Crawl each internal page
    // ------------------------------------------
    for (const url of targets) {
      const snapshot = await crawlOne(context, url);
      if (snapshot) result.pages.push(snapshot);
    }

    // ------------------------------------------
    // Compute averages
    // ------------------------------------------
    if (result.pages.length > 0) {
      const count = result.pages.length;

      const sum = result.pages.reduce(
        (acc, p) => {
          acc.titles += p.title ? 1 : 0;
          acc.descriptions += p.description ? 1 : 0;
          acc.canonicalConsistency += p.canonicalConsistent ? 1 : 0;
          acc.wordCount += p.wordCount || 0;
          return acc;
        },
        { titles: 0, descriptions: 0, canonicalConsistency: 0, wordCount: 0 }
      );

      result.avg = {
        titles: sum.titles / count,
        descriptions: sum.descriptions / count,
        canonicalConsistency: sum.canonicalConsistency / count,
        wordCount: sum.wordCount / count,
      };

      // Simple placeholder: entity drift = 1 - canonical consistency avg
      // Later we can compute based on schema & identity signals
      result.entityDrift = 1 - result.avg.canonicalConsistency;
    }

    return result;
  } catch (err) {
    console.error("crawlMultiPage error:", err);
    return result; // return partial rather than failing
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------
// Crawl a single internal page using the same context
// ---------------------------------------------------
async function crawlOne(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 45000,
    });

    // Title
    const title = await page.title();

    // Meta description
    const description = await page.$eval(
      'meta[name="description"]',
      (el) => el.content,
      null
    ).catch(() => null);

    // Canonical
    const canonical = await page.$eval(
      'link[rel="canonical"]',
      (el) => el.href,
      null
    ).catch(() => null);

    // Check canonical consistency: canonical === url (simple MVP)
    let canonicalConsistent = false;
    if (canonical && canonical.startsWith(url)) {
      canonicalConsistent = true;
    }

    // Word count (MVP — just text content length)
    const bodyText = await page.innerText("body").catch(() => "");
    const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

    return {
      url,
      title,
      description,
      canonical,
      canonicalConsistent,
      wordCount,
    };
  } catch (err) {
    console.error("crawlOne error:", err);
    return null;
  } finally {
    await page.close();
  }
}
