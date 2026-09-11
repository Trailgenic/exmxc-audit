import {
  scoreTitle, scoreMetaDescription, scoreCanonical, scoreSchemaPresence,
  scoreOrgSchema, scoreBreadcrumbSchema, scoreAuthorPerson, scoreSocialLinks,
  scoreAICrawlSignals, scoreContentDepth, scoreInternalLinks,
  scoreExternalLinks, scoreFaviconOg
} from "../shared/scoring.js";
import { TOTAL_WEIGHT } from "../shared/weights.js";
import { collectAuditEvidence, publicEvidence } from "../shared/audit-contract.js";
import { assessEntityClarityV2, emptyEcV2Template } from "../shared/entity-clarity-v2.js";
import { validateTarget } from "../shared/target-policy.js";

const SIGNAL_TIER = {
  "Title Precision": "tier3", "Meta Description Integrity": "tier3",
  "Canonical Integrity": "tier3", "Brand-Technical Consistency": "tier3",
  "Schema Presence & Validity": "tier2", "Organization Schema": "tier2",
  "Breadcrumb Schema": "tier2", "Author/Person Schema": "tier2",
  "Social Entity Links": "tier1", "Internal Lattice Integrity": "tier1",
  "External Authority Signal": "tier1", "AI Crawl Fidelity": "tier1",
  "Inference Efficiency": "tier1"
};

const TIER_LABELS = {
  tier1: "Legacy graph and content proxies",
  tier2: "Legacy structured-data proxies",
  tier3: "Legacy page-hygiene proxies"
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
function hostnameOf(value) {
  try { return new URL(value).hostname.replace(/^www\./i, ""); }
  catch { return ""; }
}

function compatibilityState(collectionStatus, accessPosture) {
  if (collectionStatus !== "delivered") return "unknown";
  if (accessPosture === "restrictive") return "blocked";
  if (accessPosture === "selective") return "defensive";
  if (accessPosture === "permissive") return "open";
  return "unknown";
}

export function buildLegacyDiagnostic(evidence) {
  const extracted = evidence.extracted;
  if (!extracted || evidence.collection.fetch_status !== "delivered") return null;
  const finalUrl = evidence.collection.final_url || evidence.collection.requested_url;
  const host = hostnameOf(finalUrl);
  const $ = extracted.$;
  const results = [
    scoreTitle($), scoreMetaDescription($), scoreCanonical($, finalUrl),
    scoreSchemaPresence(extracted.schemaObjects), scoreOrgSchema(extracted.schemaObjects),
    scoreBreadcrumbSchema(extracted.schemaObjects), scoreAuthorPerson(extracted.schemaObjects, $),
    scoreSocialLinks(extracted.schemaObjects, extracted.pageLinks), scoreAICrawlSignals($),
    scoreContentDepth($), scoreInternalLinks(extracted.pageLinks, host),
    scoreExternalLinks(extracted.pageLinks, host), scoreFaviconOg($)
  ];

  const tierRaw = { tier1: 0, tier2: 0, tier3: 0 };
  const tierMax = { tier1: 0, tier2: 0, tier3: 0 };
  let totalRaw = 0;
  for (const signal of results) {
    const safe = clamp(Number(signal.points || 0), 0, signal.max);
    const tier = SIGNAL_TIER[signal.key] || "tier3";
    totalRaw += safe;
    tierRaw[tier] += safe;
    tierMax[tier] += signal.max;
  }
  const tiers = Object.fromEntries(Object.keys(tierRaw).map(tier => [tier, {
    label: TIER_LABELS[tier], raw: tierRaw[tier], maxWeight: tierMax[tier],
    normalized: tierMax[tier] ? Number((100 * tierRaw[tier] / tierMax[tier]).toFixed(2)) : null
  }]));
  return {
    methodology: "EEI v2.1 legacy diagnostic (patched directives)",
    status: "legacy",
    interpretation_boundary: "Website-structure proxy. It does not establish model comprehension, trust, citation, recommendation, or corporate intent.",
    score: clamp(Math.round((totalRaw * 100) / TOTAL_WEIGHT), 0, 100), max: 100,
    tiers,
    signals: results.map(signal => ({
      key: signal.key, points: signal.points, max: signal.max,
      percent: signal.max ? Math.round((100 * signal.points) / signal.max) : 0,
      notes: signal.notes
    }))
  };
}

export async function runAudit(input, dependencies = {}) {
  const validated = validateTarget(input);
  if (!validated.ok) return { success: false, status: validated.status, error: validated.error };

  const evidence = await collectAuditEvidence(validated.url, dependencies);
  const legacyDiagnostic = buildLegacyDiagnostic(evidence);
  const visibleEvidence = publicEvidence(evidence);
  const assessment = assessEntityClarityV2({ checks: emptyEcV2Template() });
  const state = compatibilityState(evidence.collection.fetch_status, evidence.declared_access.posture);

  return {
    success: true,
    url: evidence.collection.final_url || validated.url,
    hostname: hostnameOf(evidence.collection.final_url || validated.url),
    methodologyVersion: "Entity Clarity evidence v2.0-pilot",
    ...visibleEvidence,
    assessment,
    model_representation: {
      status: "not_tested", results: [],
      note: "No independent model-answer test was performed by this website collection request."
    },
    legacy_diagnostic: legacyDiagnostic,
    state,
    stateReason: state === "unknown"
      ? "Access posture or page delivery was not established."
      : "Derived from declared robots policy; does not establish corporate intent.",
    entityScore: legacyDiagnostic?.score ?? null,
    ecc: { score: legacyDiagnostic?.score ?? null, max: 100, status: "legacy" },
    tierScores: legacyDiagnostic?.tiers || null,
    scoringBars: legacyDiagnostic?.signals || []
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });
  try {
    const result = await runAudit(req.query?.url);
    return res.status(result.success ? 200 : (result.status || 400)).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: "Audit failed.", details: String(error?.message || error).slice(0, 300) });
  }
}
