export const ECV2_CHECKS = [
  { id: "entity_domain_resolution", dimension: "identity", label: "Entity and domain resolve correctly" },
  { id: "institutional_scope", dimension: "identity", label: "Offering and institutional scope are clear" },
  { id: "entity_relationships", dimension: "identity", label: "Parent, brand, product, and person relationships are correct" },
  { id: "material_claim_consistency", dimension: "consistency", label: "Material identity claims agree across sampled surfaces" },
  { id: "canonical_structured_consistency", dimension: "consistency", label: "Canonical identifiers, structured data, and visible content agree" },
  { id: "official_record_consistency", dimension: "consistency", label: "Official external identity records resolve to the same entity" },
  { id: "claim_traceability", dimension: "evidence", label: "Material claims have traceable support" },
  { id: "source_provenance", dimension: "evidence", label: "Sources expose relevant authorship, date, and method" },
  { id: "independent_corroboration", dimension: "evidence", label: "Independently checkable claims have appropriate corroboration" }
];

const VALID_STATUS = new Set(["assessed", "unassessable", "not_applicable"]);

function reviewedTargetUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function emptyEcV2Template() {
  return Object.fromEntries(ECV2_CHECKS.map(check => [check.id, {
    status: "unassessable",
    points: null,
    rationale: "Requires reviewed evidence.",
    evidence: []
  }]));
}

export function assessEntityClarityV2(input = {}) {
  const provided = input.checks || {};
  const checks = ECV2_CHECKS.map(definition => {
    const value = provided[definition.id] || {};
    const status = VALID_STATUS.has(value.status) ? value.status : "unassessable";
    const points = status === "assessed" && [0, 1, 2].includes(value.points) ? value.points : null;
    const evidence = Array.isArray(value.evidence) ? value.evidence.filter(Boolean) : [];
    const validAssessment = status !== "assessed" || (points !== null && evidence.length > 0);
    return {
      ...definition,
      status: validAssessment ? status : "unassessable",
      points: validAssessment ? points : null,
      rationale: String(value.rationale || (validAssessment ? "" : "An assessed check requires points and evidence.")),
      evidence
    };
  });

  const dimensions = Object.fromEntries(["identity", "consistency", "evidence"].map(dimension => {
    const rows = checks.filter(check => check.dimension === dimension);
    const eligible = rows.filter(check => check.status !== "not_applicable");
    const assessed = eligible.filter(check => check.status === "assessed");
    const complete = eligible.length === rows.length && assessed.length === eligible.length;
    return [dimension, {
      assessed: assessed.length,
      eligible: eligible.length,
      complete,
      score: complete ? Number((100 * assessed.reduce((sum, check) => sum + check.points, 0) / (2 * eligible.length)).toFixed(2)) : null
    }];
  }));

  const assessedCount = checks.filter(check => check.status === "assessed").length;
  const reviewProvenance = {
    entity_id: typeof input.entity_id === "string" && input.entity_id ? input.entity_id : null,
    target_url: reviewedTargetUrl(input.target_url),
    reviewer_id: typeof input.reviewer_id === "string" && input.reviewer_id ? input.reviewer_id : null,
    reviewed_at: typeof input.reviewed_at === "string" && !Number.isNaN(Date.parse(input.reviewed_at)) ? input.reviewed_at : null
  };
  const provenanceComplete = Object.values(reviewProvenance).every(Boolean);
  const complete = checks.every(check => check.status === "assessed") && provenanceComplete;
  return {
    methodology: "Entity Clarity v2 pilot",
    methodology_status: "experimental",
    score_meaning: "Transparent review-check completion; not a probability of model citation, trust, or recommendation.",
    review_provenance: { ...reviewProvenance, complete: provenanceComplete },
    coverage: { assessed: assessedCount, total: checks.length, percent: Number((100 * assessedCount / checks.length).toFixed(2)) },
    comparable: complete,
    score: complete ? Number((100 * checks.reduce((sum, check) => sum + check.points, 0) / (2 * checks.length)).toFixed(2)) : null,
    dimensions,
    checks
  };
}
