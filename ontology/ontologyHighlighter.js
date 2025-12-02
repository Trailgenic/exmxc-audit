// /ontology/ontologyHighlighter.js
// v0.1 — Ontology Lens (Interpretability Only)
//
// Purpose:
//   Takes crawl data + ontology configs,
//   and produces a structured interpretive summary:
//     - domains matched
//     - signal categories present
//     - identity construction map
//     - constraints triggered
//     - schema roots & conflicts

import fs from "fs";
import path from "path";

function safeLoad(file, fallback = []) {
  try {
    const full = path.join(process.cwd(), "ontology", file);
    const raw = fs.readFileSync(full, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const cfg = {
  version: safeLoad("version.json", { id: "0.0" }),
  domains: safeLoad("domains.json", []),
  signals: safeLoad("signals.json", []),
  relationships: safeLoad("relationships.json", []),
  constraints: safeLoad("constraints.json", { constraints: [] }).constraints,
};

function hostnameOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function ontologyHighlighter({
  url,
  schemaObjects = [],
  crawlHealth = {},
  results = [],
  canonicalHref,
  entityName,
}) {
  const host = hostnameOf(url);

  /* -------------------------
     Identify Key Schema Roots
     ------------------------- */
  let orgName = null;
  let personName = null;
  const canonicalRoots = new Set();
  let canonicalRootHost = null;

  // canonical
  try {
    const c = new URL(canonicalHref || url);
    canonicalRootHost = c.hostname.replace(/^www\./i, "");
    canonicalRoots.add(canonicalRootHost);
  } catch {}

  // org/person names
  for (const o of schemaObjects) {
    const t = o["@type"];
    const types = Array.isArray(t) ? t : [t];

    if (types.includes("Organization") && !orgName) {
      orgName = o.name || null;
    }
    if (types.includes("Person") && !personName) {
      personName = o.name || null;
    }
  }

  const identityRoot = orgName || personName || entityName || host;

  /* -------------------------
     Constraint Trigger Check
     ------------------------- */
  const failedConstraints = [];

  for (const c of cfg.constraints || []) {
    try {
      const ctx = {
        canonicalRoot: canonicalRootHost,
        identityRoot,
        host,
        orgSchemaName: orgName,
        personSchemaName: personName,
        entityName,
        canonicalRoots: canonicalRoots,
        crawlHealth,
        schemaObjects,
      };

      const fn = new Function(
        "ctx",
        `const { canonicalRoot, identityRoot, host, orgSchemaName, personSchemaName, entityName, canonicalRoots, crawlHealth, schemaObjects } = ctx; return (${c.check});`
      );

      const passed = Boolean(fn(ctx));
      if (!passed) failedConstraints.push(c.id);
    } catch {
      failedConstraints.push(c.id);
    }
  }

  /* -------------------------
     Domain & Relationship Highlights
     ------------------------- */

  // Domain match: check keys that appear in schemaObjects
  const domainMatches = [];
  for (const d of cfg.domains || []) {
    const key = d.key?.toLowerCase() || "";
    const found = schemaObjects.some((o) => {
      return Object.keys(o).some((k) => k.toLowerCase().includes(key));
    });
    if (found) domainMatches.push(d);
  }

  // Relationship relevance
  const relationshipHits = [];
  for (const rel of cfg.relationships || []) {
    const src = rel.source?.toLowerCase();
    const tgt = rel.target?.toLowerCase();

    if (!src || !tgt) continue;

    const srcFound = schemaObjects.some((o) =>
      Object.keys(o).some((k) => k.toLowerCase().includes(src))
    );
    const tgtFound = schemaObjects.some((o) =>
      Object.keys(o).some((k) => k.toLowerCase().includes(tgt))
    );

    if (srcFound && tgtFound) relationshipHits.push(rel);
  }

  /* -------------------------
     Signal Highlights
     ------------------------- */
  const signalSummary = results.map((r) => ({
    key: r.key,
    points: r.points,
    max: r.max,
    percent: r.max ? Math.round((r.points / r.max) * 100) : 0,
  }));

  /* -------------------------
     Build Interpretive Summary
     ------------------------- */
  return {
    ontologyVersion: cfg.version?.id || "0.0",
    identity: {
      detectedEntityRoot: identityRoot,
      orgSchemaName: orgName,
      personSchemaName: personName,
      hostnameRoot: host,
      canonicalRoot: canonicalRootHost,
    },
    schemaStats: {
      totalSchemaBlocks: schemaObjects.length,
      hasOrgSchema: Boolean(orgName),
      hasPersonSchema: Boolean(personName),
    },
    domainMatches,
    relationshipHits,
    signalSummary,
    crawlFlags: crawlHealth?.flags || null,
    failedConstraints,
    notes: failedConstraints.length
      ? [`${failedConstraints.length} constraints failed.`]
      : ["All ontology constraints satisfied."],
  };
}
