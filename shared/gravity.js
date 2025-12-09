// /shared/gravity.js — Entity Gravity v1.0
// Blind inference of global organizational footprint
// Works with any URL using outbound + pageLinks already collected

export function computeGravity({ hostname, pageLinks }) {
  const signals = {
    subdomains: 0,
    languages: 0,
    outbound: 0,
    enterprise: 0,
    knowledge: 0
  };

  /* -----------------------------
     Normalize hostname
  ----------------------------- */
  const originHost = hostname.replace(/^www\./i, "").trim();

  /* -----------------------------
     Extract ALL hosts from links
  ----------------------------- */
  const allHosts = new Set();
  const subdomainCount = new Map();

  for (const href of pageLinks || []) {
    try {
      const u = new URL(href, `https://${originHost}`);
      const host = u.hostname.replace(/^www\./i, "");
      allHosts.add(host);

      // Count subdomains relative to main domain
      const parts = host.split(".");
      if (parts.length > 2) {
        const base = parts.slice(-2).join(".");
        const sub = parts.slice(0, -2).join(".");
        if (base === originHost && sub) {
          const key = sub.toLowerCase();
          subdomainCount.set(key, (subdomainCount.get(key) || 0) + 1);
        }
      }
    } catch (err) {
      // ignore bad URLs
    }
  }

  /* -----------------------------
     Subdomain diversity
  ----------------------------- */
  const distinctSubdomains = [...subdomainCount.keys()].length;
  if (distinctSubdomains >= 10) signals.subdomains = 4;
  else if (distinctSubdomains >= 5) signals.subdomains = 2;
  else if (distinctSubdomains >= 2) signals.subdomains = 1;

  /* -----------------------------
     Language patterns in URLs
     Detect /en-us, /de-de, ?lang=en, etc
  ----------------------------- */
  const langRegex = /(\/[a-z]{2}(-[a-z]{2})?\/)|(\?lang=)/i;
  let langHits = 0;

  for (const href of pageLinks || []) {
    if (langRegex.test(href)) langHits++;
  }

  if (langHits >= 10) signals.languages = 4;
  else if (langHits >= 5) signals.languages = 2;
  else if (langHits >= 2) signals.languages = 1;

  /* -----------------------------
     Outbound domain diversity
  ----------------------------- */
  const distinctOutbound = [...allHosts].filter(h => !h.endsWith(originHost));
  const outCount = distinctOutbound.length;

  if (outCount >= 20) signals.outbound = 4;
  else if (outCount >= 10) signals.outbound = 2;
  else if (outCount >= 3) signals.outbound = 1;

  /* -----------------------------
     Enterprise cluster
     Detect corporate lattice like:
     support., investor., developer., corporate., careers.
  ----------------------------- */
  const enterpriseKeywords = [
    "support",
    "developer",
    "investor",
    "corporate",
    "careers",
    "about",
    "help"
  ];
  let enterpriseHits = 0;

  for (const sd of subdomainCount.keys()) {
    if (enterpriseKeywords.some(k => sd.includes(k))) enterpriseHits++;
  }

  if (enterpriseHits >= 3) signals.enterprise = 4;
  else if (enterpriseHits >= 1) signals.enterprise = 1;

  /* -----------------------------
     Knowledge / Research cluster
     Detect outbound to *.edu, *.gov, *.int, wikimedia, wikidata, etc
  ----------------------------- */
  const knowledgeRegex = /\.(edu|gov|int)$/i;
  const knowledgeKeywords = [
    "wikimedia.org",
    "wikidata.org",
    "wikipedia.org"
  ];
  let knowledgeHits = 0;

  for (const h of distinctOutbound) {
    if (knowledgeRegex.test(h)) knowledgeHits++;
    if (knowledgeKeywords.some(k => h.includes(k))) knowledgeHits++;
  }

  if (knowledgeHits >= 10) signals.knowledge = 6;
  else if (knowledgeHits >= 3) signals.knowledge = 3;
  else if (knowledgeHits >= 1) signals.knowledge = 1;

  /* -----------------------------
     Final Gravity Score (0–20)
  ----------------------------- */
  const score =
    signals.subdomains +
    signals.languages +
    signals.outbound +
    signals.enterprise +
    signals.knowledge;

  /* -----------------------------
     Gravity Stage Mapping
     Minimum stage override
  ----------------------------- */
  let gravityStage = "🌑 Emergent Entity";
  if (score >= 15) gravityStage = "☀️ Sovereign Entity";
  else if (score >= 10) gravityStage = "🌕 Structured Entity";
  else if (score >= 5) gravityStage = "🌗 Visible Entity";

  return {
    score,
    stage: gravityStage,
    signals
  };
}
