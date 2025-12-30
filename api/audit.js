// /api/audit.js — EEI v7.0 (Posture + Capability + Tiers)
// -----------------------------------------------
// Posture = Blocked | Defensive | Open
// Capability Bands = Sovereign | Strategic | Emerging | Nascent
// Tier Bars preserved (Entity / Structural / Hygiene)
// No "intent", no keyword inference, no crawl-health noise.

import * as cheerio from "cheerio";
import {
  scoreTitle,
  scoreMetaDescription,
  scoreCanonical,
  scoreSchemaPresence,
  scoreOrgSchema,
  scoreBreadcrumbSchema,
  scoreAuthorPerson,
  scoreSocialLinks,
  scoreAICrawlSignals,
  scoreContentDepth,
  scoreInternalLinks,
  scoreExternalLinks,
  scoreFaviconOg,
  tierFromScore
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";
import { crawlPage } from "./core-scan.js";

/* ===============================
   HELPERS
================================ */
function normalizeUrl(input){
  let u = (input||"").trim();
  if(!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); }
  catch { return null; }
}

function hostnameOf(urlStr){
  try { return new URL(urlStr).hostname.replace(/^www\./,""); }
  catch { return ""; }
}

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

/* ===============================
   CAPABILITY BANDS
================================ */
function capabilityFromScore(score){
  if(score >= 85) return { band:"Sovereign",   color:"gold" };
  if(score >= 70) return { band:"Strategic",  color:"green" };
  if(score >= 55) return { band:"Emerging",   color:"orange" };
  return { band:"Nascent", color:"red" };
}

/* ===============================
   POSTURE CLASSIFICATION
================================ */
/**
 * Posture is based ONLY on exposure outcome:
 *
 * Blocked   = crawl fails / gated / no retrievable surface
 * Defensive = partial surface / restricted exposure / friction patterns
 * Open      = stable accessible surface with no gating
 *
 * Capability is evaluated independently from posture.
 */
function classifyPosture({ blocked, partialSurface }){
  if(blocked) return { posture:"Blocked", explanation:"Surface fully gated or inaccessible to crawlers" };
  if(partialSurface) return { posture:"Defensive", explanation:"Partial surface accessible with exposure constraints" };
  return { posture:"Open", explanation:"Surface accessible without defensive friction" };
}

/* ===============================
   SIGNAL → TIER BUCKETS
================================ */
const SIGNAL_TIER = {
  "Title Precision":"tier3",
  "Meta Description Integrity":"tier3",
  "Canonical Clarity":"tier3",
  "Brand & Technical Consistency":"tier3",

  "Schema Presence & Validity":"tier2",
  "Organization Schema":"tier2",
  "Breadcrumb Schema":"tier2",
  "Author/Person Schema":"tier2",

  "Social Entity Links":"tier1",
  "Internal Lattice Integrity":"tier1",
  "External Authority Signal":"tier1",
  "AI Crawl Fidelity":"tier1",
  "Inference Efficiency":"tier1"
};

const TIER_LABELS = {
  tier1:"Entity comprehension & trust",
  tier2:"Structural data fidelity",
  tier3:"Page-level hygiene"
};

/* ===============================
   MAIN HANDLER
================================ */
export default async function handler(req,res){

  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(200).end();

  try{
    const input = req.query?.url;
    if(!input) return res.status(400).json({ error:"Missing URL" });

    const url = normalizeUrl(input);
    if(!url) return res.status(400).json({ error:"Invalid URL format" });

    const host = hostnameOf(url);

    /* -------- CRAWL PAGE -------- */
    const crawl = await crawlPage({ url, mode:"static" });

    const blocked = !crawl || crawl.error || !crawl.html;

    if(blocked){
      return res.status(200).json({
        success:true,
        url,
        hostname:host,
        posture:"Blocked",
        postureExplanation:"Surface fully gated or inaccessible to crawlers",
        eccScore:0,
        capability:{ band:"Unknown", color:"gray" },
        tierScores:null,
        scoringBars:[],
        breakdown:[],
        timestamp:new Date().toISOString()
      });
    }

    const {
      html,
      pageLinks,
      schemaObjects,
      canonicalHref,
      title: crawlTitle,
      description: crawlDescription
    } = crawl;

    const $ = cheerio.load(html);

    const bodyText = $("body").text().replace(/\s+/g," ").trim();
    const wordCount = bodyText ? bodyText.split(" ").length : 0;

    /* -------- PARTIAL SURFACE heuristic -------- */
    const partialSurface =
      wordCount < 120 ||
      (pageLinks || []).length < 5 ||
      (schemaObjects || []).length === 0;

    /* -------- POSTURE -------- */
    const posture = classifyPosture({ blocked:false, partialSurface });

    /* -------- 13 SIGNAL SCORING -------- */
    const results = [
      scoreTitle($),
      scoreMetaDescription($),
      scoreCanonical($,url),
      scoreSchemaPresence(schemaObjects),
      scoreOrgSchema(schemaObjects),
      scoreBreadcrumbSchema(schemaObjects),
      scoreAuthorPerson(schemaObjects,$),
      scoreSocialLinks(schemaObjects,pageLinks),
      scoreAICrawlSignals($),
      scoreContentDepth($),
      scoreInternalLinks(pageLinks,host),
      scoreExternalLinks(pageLinks,host),
      scoreFaviconOg($)
    ];

    let totalRaw = 0;
    const tierRaw = { tier1:0, tier2:0, tier3:0 };
    const tierMax = { tier1:0, tier2:0, tier3:0 };

    for(const sig of results){
      const safe = clamp(sig.points||0,0,sig.max);
      const tier = SIGNAL_TIER[sig.key] || "tier3";
      totalRaw += safe;
      tierRaw[tier]+=safe;
      tierMax[tier]+=sig.max;
    }

    const eccScore = clamp(Math.round((totalRaw*100)/TOTAL_WEIGHT),0,100);
    const capability = capabilityFromScore(eccScore);

    /* -------- Tier Output -------- */
    const tierScores = {
      tier1:{
        label:TIER_LABELS.tier1,
        normalized: tierMax.tier1 ? Number(((tierRaw.tier1/tierMax.tier1)*100).toFixed(2)) : 0
      },
      tier2:{
        label:TIER_LABELS.tier2,
        normalized: tierMax.tier2 ? Number(((tierRaw.tier2/tierMax.tier2)*100).toFixed(2)) : 0
      },
      tier3:{
        label:TIER_LABELS.tier3,
        normalized: tierMax.tier3 ? Number(((tierRaw.tier3/tierMax.tier3)*100).toFixed(2)) : 0
      }
    };

    const scoringBars = results.map(r=>({
      key:r.key,
      points:r.points,
      max:r.max,
      percent:r.max ? Math.round((r.points/r.max)*100) : 0,
      notes:r.notes
    }));

    return res.status(200).json({
      success:true,
      url,
      hostname:host,

      posture: posture.posture,
      postureExplanation: posture.explanation,

      eccScore,
      capability,

      tierScores,
      scoringBars,
      breakdown:results,

      canonical: canonicalHref || url,
      title: (crawlTitle||"").trim(),
      description: crawlDescription||"",

      timestamp:new Date().toISOString()
    });

  } catch(err){
    return res.status(500).json({
      success:false,
      error:"Internal server error",
      details:err.message||String(err)
    });
  }
}
