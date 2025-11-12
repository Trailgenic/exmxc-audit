/* ======================================
   EEI v3.0 — Scoring Logic by Layer
   ====================================== */

import * as cheerio from "cheerio";
import { SIGNAL_WEIGHTS } from "./weights.js";

/* ---------- Utility ---------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function countValidSchemas(schemaObjects) {
  return schemaObjects.filter(o => o && o["@type"]).length;
}

/* ---------- META LAYER (15 pts) ---------- */
export function scoreMetaLayer($, normalizedUrl) {
  const results = [];

  // 1. Title Precision
  const title = $("title").first().text().trim();
  let titlePts = 0;
  if (title.length > 25 && /[\|\-–]/.test(title)) titlePts = SIGNAL_WEIGHTS.titlePrecision;
  else if (title.length > 15) titlePts = SIGNAL_WEIGHTS.titlePrecision * 0.6;
  results.push({ key: "Title Precision", points: titlePts, max: SIGNAL_WEIGHTS.titlePrecision, raw: { title } });

  // 2. Meta Description Integrity
  const desc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") || "";
  let descPts = 0;
  if (desc.length > 80) descPts = SIGNAL_WEIGHTS.metaDescriptionIntegrity;
  else if (desc.length > 40) descPts = SIGNAL_WEIGHTS.metaDescriptionIntegrity * 0.6;
  results.push({ key: "Meta Description Integrity", points: descPts, max: SIGNAL_WEIGHTS.metaDescriptionIntegrity, raw: { desc } });

  // 3. Canonical Clarity
  const canonical = $('link[rel="canonical"]').attr("href");
  let canPts = 0;
  if (canonical) {
    try {
      const c = new URL(canonical, normalizedUrl);
      if (c.protocol.startsWith("http") && !/[?#]/.test(c.href)) canPts = SIGNAL_WEIGHTS.canonicalClarity;
      else canPts = SIGNAL_WEIGHTS.canonicalClarity * 0.5;
    } catch {
      canPts = 0;
    }
  }
  results.push({ key: "Canonical Clarity", points: canPts, max: SIGNAL_WEIGHTS.canonicalClarity, raw: { canonical } });

  return results;
}

/* ---------- SCHEMA LAYER (30 pts) ---------- */
export function scoreSchemaLayer(schemaObjects = [], pageLinks = []) {
  const results = [];
  const validSchemas = countValidSchemas(schemaObjects);

  // 4. Schema Presence & Validity
  const presencePts = validSchemas > 0 ? SIGNAL_WEIGHTS.schemaPresenceValidity : 0;
  results.push({ key: "Schema Presence & Validity", points: presencePts, max: SIGNAL_WEIGHTS.schemaPresenceValidity, raw: { validSchemas } });

  // 5. Diversity of Types
  const types = new Set();
  schemaObjects.forEach(o => {
    if (Array.isArray(o["@type"])) o["@type"].forEach(t => types.add(t));
    else if (o["@type"]) types.add(o["@type"]);
  });
  const diversity = types.size;
  let divPts = 0;
  if (diversity >= 4) divPts = SIGNAL_WEIGHTS.schemaTypeDiversity;
  else if (diversity >= 2) divPts = SIGNAL_WEIGHTS.schemaTypeDiversity * 0.6;
  results.push({ key: "Schema Type Diversity", points: divPts, max: SIGNAL_WEIGHTS.schemaTypeDiversity, raw: { types: [...types] } });

  // 6. Depth / Nested Relations
  let relationCount = 0;
  schemaObjects.forEach(o => {
    if (o.sameAs || o.about || o.parentOrganization || o.knowsAbout) relationCount++;
  });
  const depthRatio = clamp(relationCount / validSchemas, 0, 1);
  const depthPts = SIGNAL_WEIGHTS.schemaDepthRelations * depthRatio;
  results.push({ key: "Schema Depth Relations", points: depthPts, max: SIGNAL_WEIGHTS.schemaDepthRelations, raw: { relationCount } });

  // 7. Schema-to-Scale Ratio (SSR)
  const totalLinks = pageLinks.length || 1;
  const ssr = (validSchemas / totalLinks) * 100;
  let ssrPts = 0;
  if (ssr >= 5) ssrPts = SIGNAL_WEIGHTS.schemaToScaleRatio;
  else if (ssr >= 2) ssrPts = SIGNAL_WEIGHTS.schemaToScaleRatio * 0.6;
  else if (ssr >= 0.5) ssrPts = SIGNAL_WEIGHTS.schemaToScaleRatio * 0.3;
  results.push({ key: "Schema-to-Scale Ratio (SSR)", points: ssrPts, max: SIGNAL_WEIGHTS.schemaToScaleRatio, raw: { ssr } });

  return results;
}

/* ---------- GRAPH LAYER (20 pts) ---------- */
export function scoreGraphLayer($, originHost) {
  const results = [];
  const links = $("a[href]").map((_, el) => $(el).attr("href")).get();
  const total = links.length;
  let internal = 0, externalHosts = new Set();

  links.forEach(href => {
    try {
      const u = new URL(href, `https://${originH
