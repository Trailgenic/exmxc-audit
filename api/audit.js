// /api/audit.js — EEI v6.7 (Strategy Taxonomy — Stable Edition)
// --------------------------------------------------------------
// ECC = STATIC ONLY
// Intent = Observed AI Posture (static + rendered)
// State = Crawl Context Signal (NOT business strategy)
// aiStrategy = Strategic Interpretation Layer
// --------------------------------------------------------------

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

/* ===============================
   HELPERS
================================ */

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

function eccBand(score){
  if(score >= 70) return "high";
  if(score >= 40) return "medium";
  return "low";
}

function quadrant(cap, intent){
  if(cap==="high" && intent==="high") return "AI-First Leader";
  if(cap==="high" && intent==="low")  return "Sovereign / Defensive Power";
  if(cap==="medium" && intent==="high") return "Aspirational Challenger";
  if(cap==="medium" && intent==="medium") return "Cautious Optimizer";
  return "Unclassified";
}

/* ---- Strategy Mapping ---- */

function deriveStrategy({ eccBand, intent, state }) {

  const capability =
    eccBand === "high" ? "high" :
    eccBand === "medium" ? "medium" : "low";

  let posture = "Guarded Participation";
  let rationale = "Participates in AI ecosystems with measured exposure.";

  if (intent === "high") {
    posture = "AI-Forward";
    rationale = "Signals AI alignment and discovery visibility.";
  }

  if (state.label === "suppressed") {
    posture = "Closed / Defensive";
    rationale = "Intentionally limits AI-mediated discovery and crawling.";
  }

  if (state.label === "opaque" && intent === "low") {
    posture = "Closed / Defensive";
    rationale = "Low visibility posture with constrained crawl surface.";
  }

  return {
    posture,
    quadrant: quadrant(capability, intent),
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
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)) return parsed;
    if(parsed["@graph"]) return parsed["@graph"];
    return [parsed];
  } catch { return []; }
}

/* ===============================
   STATIC CRAWL (ECC SOURCE)
================================ */
async function staticCrawl(url){
  const resp = await axios.get(url,{
    timeout: STATIC_TIMEOUT_MS,
    maxRedirects: 5,
    headers:{
      "User-Agent":"Mozilla/5.0 (compatible; exmxc-static/6.7; +https://exmxc.ai)",
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

    /* ---- STATIC CRAWL ---- */
    let staticData, staticBlocked=false;

    try{ staticData = await staticCrawl(url); }
    catch{
      staticBlocked=true;
      staticData={ html:"", title:"", description:"", canonicalHref:url,
        schemaObjects:[], pageLinks:[], wordCount:0 };
    }

    const $ = cheerio.load(staticData.html || "");

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

    /* ---- AI Intent Detection ---- */

    const intentSignals = [];

    const AI_KEYWORDS = [
      "ai","artificial intelligence","llm","agent","assistant",
      "autonomous","ai-first","ai search","copilot","model"
    ];

    const staticText =
      (staticData.title + staticData.description + staticData.html)
      .toLowerCase();

    const staticHits = AI_KEYWORDS.filter(k=>staticText.includes(k));

    // defaults
    let intent = "medium";

    const botDefenseHits = [
      "akamai","datadome","perimeterx","cloudflare","captcha",
      "access denied","verify you are human"
    ].filter(s=>staticText.includes(s));

    const looksLikeRealContent =
      (staticData.wordCount || 0) > 150 ||
      (staticData.schemaObjects || []).length > 2;

    if(staticHits.length >= 2){
      intent = "high";
      intentSignals.push(`AI-forward language detected: ${staticHits.join(", ")}`);
    }

    /* ---- RENDERED CONFIRMATION ---- */

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

    /* ---- CRAWL CONTEXT STATE ---- */

    let state = {
      label:"observed",
      reason:"Entity successfully crawled and interpreted",
      confidence:"high"
    };

    const hardSuppression =
      staticBlocked ||
      (!looksLikeRealContent && botDefenseHits.length > 0);

    if(hardSuppression){
      state = {
        label:"suppressed",
        reason:"Crawler access restricted or intentionally gated",
        confidence:"high"
      };
    }
    else if(renderedBlocked && intent === "low"){
      state = {
        label:"opaque",
        reason:"Limited visibility; posture could not be confidently inferred",
        confidence:"medium"
      };
    }

    /* ---- STRATEGY TAXONOMY ---- */

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
        raw:{ staticBlocked, renderedBlocked, botDefenseHits, intentSignals }
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
