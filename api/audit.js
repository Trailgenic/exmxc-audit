// /api/audit.js — EEI v7.0 (Exposure-First Posture Model)
// -------------------------------------------------------
// ECC = STATIC ONLY (capability)
// STATE = Exposure / Crawl Friction (mechanical truth)
// INTENT = Observed exposure posture (derived from state)
// STRATEGY = Business lens layered on capability × posture
//
// Core ladder:
// observed  → entity exposes discovery surface
// opaque    → defensive friction but still retrievable
// suppressed → discovery meaningfully limited
// blocked   → AI discovery explicitly denied
// -------------------------------------------------------

import axios from "axios";
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
  scoreFaviconOg
} from "../shared/scoring.js";

import { TOTAL_WEIGHT } from "../shared/weights.js";

const RENDER_WORKER =
  "https://exmxc-crawl-worker-production.up.railway.app";

const STATIC_TIMEOUT_MS = 6000;
const RENDER_TIMEOUT_MS = 8000;

/* ===============================
   Helpers
================================ */
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

function eccBand(score){
  if(score >= 70) return "high";
  if(score >= 40) return "medium";
  return "low";
}

function quadrant(capability,intent){
  if(capability==="high" && intent==="high") return "AI-First Leader";
  if(capability==="high" && intent==="low")  return "Sovereign / Defensive Power";
  if(capability==="medium" && intent==="high") return "Aspirational Challenger";
  if(capability==="medium" && intent==="medium") return "Cautious Optimizer";
  return "Unclassified";
}

/* === Strategy Mapping (Business Lens) ================= */
function deriveStrategy({ eccBand:intCap, intent }){

  const capability =
    intCap==="high" ? "high" :
    intCap==="medium" ? "medium" : "low";

  let posture = "Guarded Participation";
  let rationale = "";

  if(intent==="high"){
    posture = "AI-Forward";
    rationale = "Actively exposes discovery surface with minimal friction.";
  }
  else if(intent==="medium"){
    posture = "Selective Exposure";
    rationale = "Participates in AI discovery with controlled surface friction.";
  }
  else if(intent==="low"){
    posture = "Closed / Defensive";
    rationale = "Structured presence but intentionally limits discovery exposure.";
  }
  else if(intent==="blocked"){
    posture = "Hard Exclusion";
    rationale = "Explicitly prevents AI-mediated discovery.";
  }

  return {
    posture,
    quadrant: quadrant(capability,intent==="blocked"?"low":intent),
    capability,
    intent,
    rationale
  };
}

/* ===============================
   JSON-LD Parser
================================ */
function parseJsonLd(raw){
  try{
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)) return parsed;
    if(parsed["@graph"]) return parsed["@graph"];
    return [parsed];
  } catch { return []; }
}

/* ===============================
   Static Crawl (ECC Source)
================================ */
async function staticCrawl(url){
  const resp = await axios.get(url,{
    timeout: STATIC_TIMEOUT_MS,
    maxRedirects: 5,
    headers:{
      "User-Agent":"Mozilla/5.0 (compatible; exmxc-eei/7.0)",
      Accept:"text/html"
    }
  });

  const html = resp.data || "";
  const $ = cheerio.load(html);

  const schemaObjects = $('script[type="application/ld+json"]')
    .map((_,el)=>parseJsonLd($(el).text()))
    .get()
    .flat();

  const pageLinks = $("a[href]")
    .map((_,el)=>$(el).attr("href"))
    .get()
    .filter(Boolean);

  const bodyText = $("body").text().replace(/\s+/g," ").trim();

  return {
    html,
    title:$("title").first().text().trim(),
    description:$('meta[name="description"]').attr("content") ||
                 $('meta[property="og:description"]').attr("content") || "",
    canonicalHref:$('link[rel="canonical"]').attr("href") || url,
    schemaObjects,
    pageLinks,
    wordCount: bodyText ? bodyText.split(" ").length : 0
  };
}

/* ===============================
   Handler
================================ */
export default async function handler(req,res){

  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");

  if(req.method==="OPTIONS") return res.status(200).end();

  try{
    const input = req.method==="POST" ? req.body?.url : req.query?.url;
    if(!input || typeof input!=="string"){
      return res.status(400).json({ success:false, error:"Missing URL" });
    }

    const url = input.startsWith("http") ? input : `https://${input}`;
    const host = new URL(url).hostname.replace(/^www\./,"");

    /* ---- STATIC CRAWL ---- */
    let staticData, staticBlocked=false;
    let botDefenseHits=[];

    try{
      staticData = await staticCrawl(url);
    } catch {
      staticBlocked=true;
      staticData={ html:"",title:"",description:"",canonicalHref:url,
        schemaObjects:[],pageLinks:[],wordCount:0 };
    }

    const $ = cheerio.load(staticData.html || "");

    // Detect visible bot-defense hints (soft friction)
    const htmlLower = (staticData.html||"").toLowerCase();
    if(htmlLower.includes("cloudflare")) botDefenseHits.push("cloudflare");
    if(htmlLower.includes("akamai")) botDefenseHits.push("akamai");
    if(htmlLower.includes("captcha")) botDefenseHits.push("captcha");

    /* ---- ECC (Capability) ---- */
    const breakdown = [
      scoreTitle($,staticData),
      scoreMetaDescription($,staticData),
      scoreCanonical($,url,staticData),
      scoreSchemaPresence(staticData.schemaObjects),
      scoreOrgSchema(staticData.schemaObjects),
      scoreBreadcrumbSchema(staticData.schemaObjects),
      scoreAuthorPerson(staticData.schemaObjects,$),
      scoreSocialLinks(staticData.schemaObjects,staticData.pageLinks),
      scoreAICrawlSignals($),
      scoreContentDepth($,staticData),
      scoreInternalLinks(staticData.pageLinks,host),
      scoreExternalLinks(staticData.pageLinks,host),
      scoreFaviconOg($)
    ];

    let raw=0;
    for(const b of breakdown) raw+=clamp(b.points||0,0,b.max);

    const eccScore = staticBlocked ? 0 :
      clamp(Math.round((raw*100)/TOTAL_WEIGHT),0,100);

    const ecc = eccBand(eccScore);

    /* ---- RENDER CHECK (Exposure Confirmation) ---- */
    let renderedBlocked=false;
    try{
      await axios.post(`${RENDER_WORKER}/crawl`,{url},{timeout:RENDER_TIMEOUT_MS});
    } catch {
      renderedBlocked=true;
    }

    /* ============================================
       EXPOSURE-FIRST STATE MODEL
       ============================================ */

    const hasRealContent =
      (staticData.wordCount||0) > 150 ||
      (staticData.schemaObjects||[]).length > 2;

    let state = {
      label: "observed",
      reason: "Entity exposes meaningful crawl surface",
      confidence: "high"
    };

    if(staticBlocked){
      state = {
        label: "blocked",
        reason: "Static surface inaccessible / hard denial",
        confidence: "high"
      };
    }
    else if(!hasRealContent && botDefenseHits.length){
      state = {
        label: "suppressed",
        reason: "Discovery access intentionally limited behind defenses",
        confidence: "high"
      };
    }
    else if(renderedBlocked && botDefenseHits.length){
      state = {
        label: "opaque",
        reason: "Partial surface accessible but defensive friction present",
        confidence: "medium"
      };
    }

    /* ---- INTENT FROM STATE (Exposure Posture) ---- */

    let intent = "medium";

    if(state.label==="observed") intent = "high";
    if(state.label==="opaque")   intent = "low";
    if(state.label==="suppressed") intent = "low";
    if(state.label==="blocked")   intent = "blocked";

    /* ---- STRATEGY (Business Lens) ---- */
    const aiStrategy = deriveStrategy({
      eccBand:ecc,
      intent
    });

    /* ---- RESPONSE ---- */
    return res.status(200).json({
      success:true,
      url,
      hostname:host,

      ecc:{ score:eccScore, band:ecc, max:100 },

      intent:{ posture:intent },
      state,
      aiStrategy,
      quadrant: aiStrategy.quadrant,
      breakdown,

      exposureSignals:{ staticBlocked, renderedBlocked, botDefenseHits },

      timestamp:new Date().toISOString()
    });

  } catch(err){
    return res.status(500).json({
      success:false,
      error:err.message || "Internal error"
    });
  }
}
