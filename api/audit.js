// /api/audit.js — EEI v6.8 (Exposure-First Intent Engine)
// -------------------------------------------------------
// ECC  = Static Capability (quality layer)
// State = Crawl Exposure (not strategy)
// Intent = Participation posture (capped by exposure)
// aiStrategy = Business Strategy Lens

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

/* ===============================
   CONFIG
================================ */
const RENDER_WORKER =
  "https://exmxc-crawl-worker-production.up.railway.app";

const STATIC_TIMEOUT_MS = 6000;
const RENDER_TIMEOUT_MS = 8000;

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

function eccBand(score){
  if(score>=70) return "high";
  if(score>=40) return "medium";
  return "low";
}

function quadrant(cap,intent){
  if(cap==="high" && intent==="high") return "AI-First Leader";
  if(cap==="high" && intent==="low") return "Sovereign / Defensive Power";
  if(cap==="medium" && intent==="high") return "Aspirational Challenger";
  if(cap==="medium" && intent==="medium") return "Cautious Optimizer";
  return "Unclassified";
}

/* ===============================
   EXPOSURE-FIRST ENGINE
================================ */

// Crawl Exposure → canonical state
function deriveExposureState({ staticBlocked=false, renderedBlocked=false, botDefenseHits=[] } = {}){
  // Fully suppressed — no surface allowed to crawlers
  if(staticBlocked && renderedBlocked){
    return {
      label:"suppressed",
      reason:"Crawler access blocked at both static and rendered layers",
      confidence:"high"
    };
  }

  // Opaque / guarded — partial surface with friction or defenses
  if(renderedBlocked || (botDefenseHits||[]).length>0){
    return {
      label:"opaque",
      reason:"Partial surface accessible but defensive friction present",
      confidence:"medium"
    };
  }

  // Full surface observable
  return {
    label:"observed",
    reason:"Entity successfully crawled and interpreted",
    confidence:"high"
  };
}

// Exposure caps intent — keywords do NOT escalate
function deriveIntentFromExposure(stateLabel,{ wordCount=0, aiPing=false } = {}){
  switch(stateLabel){

    case "suppressed":
      return {
        posture:"low",
        ceiling:"low",
        rationale:"Discovery surface intentionally withheld from crawlers."
      };

    case "opaque":
      // limited participation — can rise only to medium
      return {
        posture: wordCount>900 ? "medium" : "low",
        ceiling:"medium",
        rationale:"Meaningful surface exists but exposure is intentionally constrained."
      };

    case "observed":
      // only here can high intent exist
      return {
        posture:(aiPing || wordCount>1200) ? "high" : "medium",
        ceiling:"high",
        rationale:"Entity exposes full surface suitable for AI-mediated discovery."
      };

    default:
      return { posture:"low", ceiling:"low", rationale:"Unknown exposure environment." };
  }
}

// Business lens — state dominates narrative
function deriveStrategy({ capability, state, intent }){
  if(state.label==="suppressed"){
    return {
      posture:"Closed / Suppressed",
      quadrant:"Sovereign / Defensive Power",
      capability,
      intent:"low",
      rationale:"Prioritizes access control and minimizes AI discovery exposure."
    };
  }

  if(state.label==="opaque"){
    return {
      posture:"Guarded Participation",
      quadrant:"Sovereign / Defensive Power",
      capability,
      intent:intent.posture,
      rationale:"Structured presence with constrained surface visibility."
    };
  }

  if(state.label==="observed" && intent.posture==="high"){
    return {
      posture:"AI-Forward",
      quadrant:"AI-First Leader",
      capability,
      intent:"high",
      rationale:"Entity participates openly and enables full AI-driven comprehension."
    };
  }

  return {
    posture:"Open but Cautious",
    quadrant:"Emergent Participant",
    capability,
    intent:intent.posture,
    rationale:"Visible participation without explicit AI-forward enablement."
  };
}

/* ===============================
   JSON-LD PARSER
================================ */
function parseJsonLd(raw){
  try{
    const p=JSON.parse(raw);
    if(Array.isArray(p)) return p;
    if(p["@graph"]) return p["@graph"];
    return [p];
  } catch { return []; }
}

/* ===============================
   STATIC CRAWL
================================ */
async function staticCrawl(url){
  const resp = await axios.get(url,{
    timeout:STATIC_TIMEOUT_MS,
    maxRedirects:5,
    headers:{
      "User-Agent":"Mozilla/5.0 (compatible; exmxc-static/6.8; +https://exmxc.ai)",
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
   HANDLER
================================ */
export default async function handler(req,res){

  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(200).end();

  try{
    const input = req.method==="POST" ? req.body?.url : req.query?.url;
    if(!input || typeof input!=="string"){
      return res.status(400).json({ success:false, error:"Missing URL" });
    }

    const debug = req.query?.debug==="1" || req.headers["x-eei-debug"]==="true";
    const url = input.startsWith("http") ? input : `https://${input}`;
    const host = new URL(url).hostname.replace(/^www\./,"");

    /* ---- STATIC ---- */
    let staticData, staticBlocked=false;
    try{ staticData = await staticCrawl(url); }
    catch{
      staticBlocked=true;
      staticData={ html:"", title:"", description:"", canonicalHref:url,
        schemaObjects:[], pageLinks:[], wordCount:0 };
    }

    const $ = cheerio.load(staticData.html||"");

    /* ---- ECC ---- */
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

    /* ---- RENDER CONFIRMATION ---- */
    let renderedBlocked=false, botDefenseHits=[], aiPing=false;

    try{
      const rendered = await axios.post(
        `${RENDER_WORKER}/crawl`,
        { url },
        { timeout:RENDER_TIMEOUT_MS }
      );

      const renderedText = JSON.stringify(rendered.data||{}).toLowerCase();
      aiPing = renderedText.includes("ai") || renderedText.includes("llm");

      if(rendered.data?.botDefense){
        botDefenseHits = rendered.data.botDefense;
      }

    } catch{
      renderedBlocked=true;
    }

    /* ---- EXPOSURE-FIRST STATE ---- */
    const exposureSignals = { staticBlocked, renderedBlocked, botDefenseHits };

    const state = deriveExposureState(exposureSignals);

    const intent = deriveIntentFromExposure(
      state.label,
      { wordCount: staticData.wordCount, aiPing }
    );

    const aiStrategy = deriveStrategy({
      capability:ecc,
      state,
      intent
    });

    /* ---- RESPONSE ---- */
    return res.status(200).json({

      success:true,
      url,
      hostname:host,

      ecc:{ score:eccScore, band:ecc, max:100 },

      intent:{
        posture:intent.posture,
        ceiling:intent.ceiling,
        rationale:intent.rationale
      },

      state,
      aiStrategy,
      quadrant: aiStrategy.quadrant,
      breakdown,

      ...(debug && { raw:{ exposureSignals, aiPing } }),

      timestamp:new Date().toISOString()
    });

  } catch(err){
    return res.status(500).json({
      success:false,
      error:err.message || "Internal error"
    });
  }
}
