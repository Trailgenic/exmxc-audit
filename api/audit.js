/* =======================================================
   /api/audit.js — EEI v7.1
   Exposure-First Intent Model + Strategy Taxonomy
   -------------------------------------------------------
   ECC  = Static Capability (structure & signals)
   Intent = Business Posture (exposure vs gating)
   State = Crawl Context (surface access reality)
   aiStrategy = Canonical Strategic Lens
======================================================= */

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

const AI_KEYWORDS = [
  "ai","machine learning","llm","model","gen ai","artificial intelligence",
  "chatbot","ai platform","ai tools","ai strategy","ai solutions"
];

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

/* === Strategy Mapping ========================= */

function deriveStrategy({ eccBand:intentCap, intent, state }){

  const capability =
    intentCap==="high" ? "high" :
    intentCap==="medium" ? "medium" : "low";

  let posture = "Guarded Participation";
  let rationale = "";

  if(intent==="high"){
    posture="AI-Forward";
    rationale="Entity exposes meaningful surface for AI-mediated discovery.";
  }

  if(state.label==="suppressed"){
    posture="Closed / Defensive";
    rationale="Discovery surface intentionally gated or minimized.";
  }

  if(state.label==="opaque" && intent==="low"){
    posture="Closed / Defensive";
    rationale="Limited crawl visibility with defensive friction shaping access.";
  }

  return {
    posture,
    quadrant: quadrant(capability,intent),
    capability,
    intent,
    rationale
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
   STATIC CRAWL (ECC SOURCE)
================================ */
async function staticCrawl(url){
  const resp = await axios.get(url,{
    timeout:STATIC_TIMEOUT_MS,
    maxRedirects:5,
    headers:{
      "User-Agent":"Mozilla/5.0 (compatible; exmxc-static/7.1; +https://exmxc.ai)",
      Accept:"text/html"
    }
  });

  const html=resp.data||"";
  const $=cheerio.load(html);

  const schemaObjects=$('script[type="application/ld+json"]')
    .map((_,el)=>parseJsonLd($(el).text()))
    .get().flat();

  const pageLinks=$("a[href]").map((_,el)=>$(el).attr("href"))
    .get().filter(Boolean);

  const bodyText=$("body").text().replace(/\s+/g," ").trim();

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
    const input=req.method==="POST" ? req.body?.url : req.query?.url;
    if(!input || typeof input!=="string"){
      return res.status(400).json({ success:false, error:"Missing URL" });
    }

    const debug=req.query?.debug==="1" || req.headers["x-eei-debug"]==="true";
    const url=input.startsWith("http") ? input : `https://${input}`;
    const host=new URL(url).hostname.replace(/^www\./,"");

    /* ---- STATIC ---- */
    let staticData, staticBlocked=false;
    try{ staticData=await staticCrawl(url); }
    catch{
      staticBlocked=true;
      staticData={ html:"", title:"", description:"", canonicalHref:url,
        schemaObjects:[], pageLinks:[], wordCount:0 };
    }

    const $=cheerio.load(staticData.html||"");

    /* ---- ECC ---- */
    const breakdown=[
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
    const eccScore=staticBlocked ? 0 :
      clamp(Math.round((raw*100)/TOTAL_WEIGHT),0,100);
    const ecc=eccBand(eccScore);

    /* ---- EXPOSURE-FIRST INTENT ---------------- */

    const hasRealContent =
      (staticData.wordCount||0) > 150 ||
      (staticData.schemaObjects||[]).length > 2;

    let intentSignals=[];
    let botDefenseHits=[];

    const htmlLower=(staticData.html||"").toLowerCase();
    ["cloudflare","akamai","ddos","captcha","bot protection"]
      .forEach(k=>{ if(htmlLower.includes(k)) botDefenseHits.push(k); });

    let intent = "medium";   // default participatory

    // AI-forward language boosts to HIGH
    const staticHits = AI_KEYWORDS.filter(k =>
      htmlLower.includes(k)
    );
    if(staticHits.length>=2){
      intent="high";
      intentSignals.push(`AI-language detected: ${staticHits.join(", ")}`);
    }

    /* ---- RENDER PASS ---- */
    let renderedBlocked=false;
    try{
      const rendered = await axios.post(
        `${RENDER_WORKER}/crawl`,
        {url},
        {timeout:RENDER_TIMEOUT_MS}
      );
      const renderedText = JSON.stringify(rendered.data||{}).toLowerCase();
      const renderedHits = AI_KEYWORDS.filter(k=>renderedText.includes(k));
      if(renderedHits.length && intent!=="high" && botDefenseHits.length===0){
        intent="high";
        intentSignals.push(
          `AI posture confirmed via render: ${renderedHits.join(", ")}`
        );
      }
    } catch{
      renderedBlocked=true;
      intentSignals.push("Rendered crawl blocked / timed out");
    }

    /* ---- CRAWL CONTEXT STATE (EXPOSURE LADDER) ---- */

    let state={
      label:"observed",
      reason:"Entity exposes meaningful discovery surface",
      confidence:"high"
    };

    // Hard suppression — access truly restricted
    const hardSuppression =
      staticBlocked ||
      (!hasRealContent && botDefenseHits.length>0);

    if(hardSuppression){
      state={
        label:"suppressed",
        reason:"Crawler access restricted or intentionally gated",
        confidence:"high"
      };
      intent="low";
    }

    // Opaque only when friction *limits* meaningful access
    else if(renderedBlocked && botDefenseHits.length>0 && !hasRealContent){
      state={
        label:"opaque",
        reason:"Defensive friction limits meaningful discovery surface",
        confidence:"medium"
      };
      intent="low";
    }

    // Otherwise — still exposed despite background defenses
    else if(hasRealContent && botDefenseHits.length>0){
      state={
        label:"observed",
        reason:"Meaningful surface exposed despite defensive infrastructure",
        confidence:"high"
      };
    }

    /* ---- STRATEGY LENS ---- */
    const aiStrategy = deriveStrategy({
      eccBand:ecc,
      intent,
      state
    });

    /* ---- RESPONSE ---- */
    return res.status(200).json({
      success:true,
      url,
      hostname:host,

      ecc:{ score:eccScore, band:ecc, max:100 },

      intent:{
        posture:intent,
        signals:intentSignals,
        observedFrom:["static","rendered"]
      },

      state,
      aiStrategy,
      quadrant: aiStrategy.quadrant,
      breakdown,

      ...(debug && {
        raw:{ staticBlocked, renderedBlocked, botDefenseHits, intentSignals, hasRealContent }
      }),

      timestamp:new Date().toISOString()
    });

  } catch(err){
    return res.status(500).json({
      success:false,
      error:err.message || "Internal error"
    });
  }
}
