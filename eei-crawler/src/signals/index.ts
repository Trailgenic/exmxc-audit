// eei-crawler/src/signals/index.ts

/**
 * EEI Signal Engine — Tier 1 + Tier 2 (Full File)
 *
 * This module runs all implemented signals:
 *  - Tier 1: Internal Lattice, External Authority, AI Crawl, Content Depth
 *  - Tier 2: Schema Presence, Organization Schema, Breadcrumb Schema, Author/Person Schema
 *
 * Tier 3 will be added later without modifying the structure.
 */

import * as cheerio from "cheerio";
import type { SignalResult } from "../models/types";

export async function runAllSignals(html: string, url: string): Promise<SignalResult[]> {
  const $ = cheerio.load(html);
  const originHost = new URL(url).hostname.replace(/^www\./, "");

  const pageLinks: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) pageLinks.push(href);
  });

  // Extract all JSON-LD blocks
  const schemaObjects: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      if (Array.isArray(parsed)) schemaObjects.push(...parsed);
      else schemaObjects.push(parsed);
    } catch {
      // ignore invalid JSON-LD
    }
  });

  const signals: SignalResult[] = [];

  /* ===============================
     TIER 1 — AI COMPREHENSION
     =============================== */
  signals.push(scoreInternalLinks(pageLinks, originHost));
  signals.push(scoreExternalLinks(pageLinks, originHost));
  signals.push(scoreAICrawlSignals($));
  signals.push(scoreContentDepth($));

  /* ===============================
     TIER 2 — STRUCTURAL DATA
     =============================== */
  signals.push(scoreSchemaPresence(schemaObjects));
  signals.push(scoreOrganizationSchema(schemaObjects));
  signals.push(scoreBreadcrumbSchema(schemaObjects));
  signals.push(scoreAuthorPerson(schemaObjects, $));

  return signals;
}

/* ============================================================
   TIER 1 SIGNALS
   ============================================================ */

function scoreInternalLinks(pageLinks: string[], originHost: string): SignalResult {
  let total = 0;
  let internal = 0;

  for (const href of pageLinks) {
    total++;
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./, "");
      if (host === originHost) internal++;
    } catch {}
  }

  const ratio = total ? internal / total : 0;

  let score = 0;
  let notes = "No internal links";

  if (ratio >= 0.5 && internal >= 10) {
    score = 45;
    notes = "Strong lattice";
  } else if (ratio >= 0.2 && internal >= 3) {
    score = 22;
    notes = "Some internal linking";
  }

  return {
    name: "Internal Lattice Integrity",
    score,
    max: 45,
    notes,
    raw: { total, internal, ratio }
  };
}

function scoreExternalLinks(pageLinks: string[], originHost: string): SignalResult {
  const external = new Set<string>();

  for (const href of pageLinks) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./, "");
      if (host !== originHost) external.add(host);
    } catch {}
  }

  const count = external.size;
  const score = count >= 1 ? 8 : 0;
  const notes = count >= 1 ? "Outbound credibility present" : "No outbound links";

  return {
    name: "External Authority Signal",
    score,
    max: 8,
    notes,
    raw: { count, distinctOutboundHosts: [...external] }
  };
}

function scoreAICrawlSignals($: cheerio.CheerioAPI): SignalResult {
  const robots = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const aiPing = $('img[src*="ai-crawl-ping"], img[src*="crawl-ping"]').length > 0;

  const allowIndex = robots === "" || /index/.test(robots);

  let score = 0;
  let notes = "Blocked";

  if (!allowIndex) {
    score = 0;
    notes = "Robots block indexing";
  } else if (aiPing) {
    score = 12;
    notes = "Explicit crawl ping";
  } else {
    score = 7;
    notes = "Indexable, no explicit ping";
  }

  return {
    name: "AI Crawl Fidelity",
    score,
    max: 12,
    notes,
    raw: { robots, aiPing }
  };
}

function scoreContentDepth($: cheerio.CheerioAPI): SignalResult {
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;

  let score = 0;
  let notes = "Shallow (<300 words)";

  if (words >= 1200) {
    score = 12;
    notes = "Deep context";
  } else if (words >= 300) {
    score = 6;
    notes = "Moderate";
  }

  return {
    name: "Inference Efficiency",
    score,
    max: 12,
    notes,
    raw: { wordCount: words }
  };
}

/* ============================================================
   TIER 2 SIGNALS
   ============================================================ */

function scoreSchemaPresence(schemaObjects: any[]): SignalResult {
  const count = schemaObjects.length;

  let score = 0;
  let notes = "No JSON-LD found";

  if (count >= 3) {
    score = 25;
    notes = "Multiple schema blocks";
  } else if (count === 1 || count === 2) {
    score = 12;
    notes = "Limited schema coverage";
  }

  return {
    name: "Schema Presence & Validity",
    score,
    max: 25,
    notes,
    raw: { schemaBlocks: count }
  };
}

function scoreOrganizationSchema(schemaObjects: any[]): SignalResult {
  const org = schemaObjects.find(o =>
    o["@type"] === "Organization" ||
    (Array.isArray(o["@type"]) && o["@type"].includes("Organization"))
  );

  let score = 0;
  let notes = "Missing organization schema";

  if (org) {
    const valid = !!org.name && !!org.url;
    score = valid ? 10 : 5;
    notes = valid ? "Organization schema valid" : "Organization schema incomplete";
  }

  return {
    name: "Organization Schema",
    score,
    max: 10,
    notes,
    raw: org || null
  };
}

function scoreBreadcrumbSchema(schemaObjects: any[]): SignalResult {
  const crumb = schemaObjects.find(o =>
    o["@type"] === "BreadcrumbList" ||
    (Array.isArray(o["@type"]) && o["@type"].includes("BreadcrumbList"))
  );

  const score = crumb ? 5 : 0;
  const notes = crumb ? "Breadcrumb schema present" : "Missing";

  return {
    name: "Breadcrumb Schema",
    score,
    max: 5,
    notes,
    raw: crumb || null
  };
}

function scoreAuthorPerson(schemaObjects: any[], $: cheerio.CheerioAPI): SignalResult {
  const person = schemaObjects.find(o =>
    o["@type"] === "Person" ||
    (Array.isArray(o["@type"]) && o["@type"].includes("Person"))
  );

  const metaAuthor =
    $('meta[name="author"]').attr("content") ||
    $('a[rel="author"]').text() ||
    "";

  let score = 0;
  let notes = "Missing";

  if (person) {
    score = 5;
    notes = "Person schema present";
  } else if (metaAuthor) {
    score = 2;
    notes = "Author meta tag present";
  }

  return {
    name: "Author/Person Schema",
    score,
    max: 5,
    notes,
    raw: { person: !!person, metaAuthor }
  };
}
