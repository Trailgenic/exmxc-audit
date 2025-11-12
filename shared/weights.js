/* ================================
   EEI v3.0 — Weights Configuration
   ================================ */

export const LAYER_WEIGHTS = {
  meta: 15,
  schema: 30,
  graph: 20,
  trust: 20,
  ai: 15
};

export const SIGNAL_WEIGHTS = {
  // META (15)
  titlePrecision: 5,
  metaDescriptionIntegrity: 5,
  canonicalClarity: 5,

  // SCHEMA (30)
  schemaPresenceValidity: 10,
  schemaTypeDiversity: 8,
  schemaDepthRelations: 7,
  schemaToScaleRatio: 5,

  // GRAPH (20)
  internalLatticeIntegrity: 12,
  externalAuthoritySignal: 8,

  // TRUST (20)
  robotsHealth: 10,
  brandTechConsistency: 10,

  // AI COMPREHENSION (15)
  crawlFidelity: 8,
  inferenceEfficiency: 7
};
