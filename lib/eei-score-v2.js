// /lib/eei-score-v2.js
// EEI Scoring v2 — Entity-First AI Comprehension

export function scoreEntity(entitySignals) {
  let score = 0;
  const max = 100;

  /* ============================================================
     1. SURFACE CONFIDENCE (20 pts)
     ============================================================ */
  if (entitySignals.surfaceCount >= 3) score += 20;
  else if (entitySignals.surfaceCount === 2) score += 14;
  else score += 6;

  /* ============================================================
     2. CONTENT DEPTH (15 pts)
     ============================================================ */
  if (entitySignals.contentDepth >= 3000) score += 15;
  else if (entitySignals.contentDepth >= 1500) score += 10;
  else if (entitySignals.contentDepth >= 600) score += 6;
  else score += 2;

  /* ============================================================
     3. SCHEMA CONFIDENCE (20 pts)
     ============================================================ */
  if (
    entitySignals.schemaCoverage >= 4 &&
    entitySignals.schemaDiversity >= 3
  ) {
    score += 20;
  } else if (entitySignals.schemaCoverage >= 2) {
    score += 14;
  } else if (entitySignals.schemaCoverage >= 1) {
    score += 8;
  } else {
    score += 0;
  }

  /* ============================================================
     4. CANONICAL STABILITY (15 pts)
     ============================================================ */
  if (entitySignals.canonicalConsistency) score += 15;
  else if (entitySignals.canonicalCount <= 2) score += 8;
  else score += 0;

  /* ============================================================
     5. INTERNAL COHERENCE (15 pts)
     ============================================================ */
  if (entitySignals.internalLinkStrength >= 0.6) score += 15;
  else if (entitySignals.internalLinkStrength >= 0.35) score += 9;
  else if (entitySignals.internalLinkStrength >= 0.15) score += 4;
  else score += 0;

  /* ============================================================
     6. SOCIAL AUTHORITY (10 pts)
     ============================================================ */
  if (entitySignals.socialAuthorityCount >= 4) score += 10;
  else if (entitySignals.socialAuthorityCount >= 2) score += 6;
  else if (entitySignals.socialAuthorityCount >= 1) score += 3;
  else score += 0;

  /* ============================================================
     7. TITLE CONSISTENCY (5 pts)
     ============================================================ */
  if (entitySignals.titleConsistency >= 0.9) score += 5;
  else if (entitySignals.titleConsistency >= 0.6) score += 3;
  else score += 1;

  /* ============================================================
     STAGE CLASSIFICATION
     ============================================================ */
  let stage = "🌑 Emergent Entity";
  let verb = "Define";

  if (score >= 75) {
    stage = "🌕 Structured Entity";
    verb = "Expand";
  } else if (score >= 50) {
    stage = "🌗 Visible Entity";
    verb = "Clarify";
  }

  return {
    eeiScore: Math.min(score, max),
    eeiStage: stage,
    eeiVerb: verb,
    explanation: explain(score)
  };
}

function explain(score) {
  if (score >= 75)
    return "AI reconstructs identity reliably across multiple surfaces.";
  if (score >= 50)
    return "Entity recognized but signals are inconsistent or incomplete.";
  return "AI must infer identity. Structure insufficient.";
}
