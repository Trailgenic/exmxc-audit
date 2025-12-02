// /api/ontology/index.js — Ontology v0.0.1 Engine
import fs from "fs/promises";
import path from "path";

const ONTOLOGY_DIR = path.join(process.cwd(), "ontology");

let cachedOntology = null;

async function loadJson(file) {
  const fullPath = path.join(ONTOLOGY_DIR, file);
  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw);
}

export async function loadOntology() {
  if (cachedOntology) return cachedOntology;

  const [version, domains, signals, relationships, constraints] =
    await Promise.all([
      loadJson("version.json"),
      loadJson("domains.json"),
      loadJson("signals.json"),
      loadJson("relationships.json"),
      loadJson("constraints.json"),
    ]);

  cachedOntology = {
    version,
    domains,
    signals,
    relationships,
    constraints,
  };

  return cachedOntology;
}

/**
 * v0.0 ontology evaluation:
 * works off single-page data (no multi-surface yet).
 *
 * @param {Object} params
 * @param {string} params.url
 * @param {string} params.hostname
 * @param {string} params.canonical
 * @param {Array<Object>} params.schemaObjects
 * @param {Array<Object>} params.breakdown  // 13 signals array
 * @param {Array<string>} params.socialUrls // optional: parsed from schema or links
 */
export async function evaluateOntology({
  url,
  hostname,
  canonical,
  schemaObjects = [],
  breakdown = [],
  socialUrls = [],
}) {
  const ontology = await loadOntology();
  const { constraints, version } = ontology;

  const failedConstraints = [];
  let totalSeverity = 0;
  let appliedSeverity = 0;

  const rootHost = (hostname || "").replace(/^www\./i, "");

  const canonicalHost = (() => {
    try {
      return new URL(canonical || url).hostname.replace(/^www\./i, "");
    } catch {
      return rootHost;
    }
  })();

  const orgNodes = schemaObjects.filter(
    (o) =>
      o["@type"] === "Organization" ||
      (Array.isArray(o["@type"]) && o["@type"].includes("Organization"))
  );

  const breadcrumbNodes = schemaObjects.filter(
    (o) =>
      o["@type"] === "BreadcrumbList" ||
      (Array.isArray(o["@type"]) && o["@type"].includes("BreadcrumbList"))
  );

  const orgUrls = [];
  for (const org of orgNodes) {
    if (org.url) orgUrls.push(org.url);
    if (Array.isArray(org.sameAs)) org.sameAs.forEach((u) => u && orgUrls.push(u));
  }

  const socialCandidates = [...socialUrls];
  for (const u of orgUrls) {
    if (typeof u === "string" && /twitter\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com/i.test(u)) {
      socialCandidates.push(u);
    }
  }

  const normalizeHost = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  };

  // Evaluate constraints
  for (const c of constraints) {
    const severity = c.severity ?? 0.5;
    totalSeverity += severity;

    let failed = false;
    let detail = "";

    switch (c.logic?.type) {
      case "canonical-domain-match": {
        if (rootHost && canonicalHost && rootHost !== canonicalHost) {
          failed = true;
          detail = `Canonical domain "${canonicalHost}" differs from page host "${rootHost}".`;
        }
        break;
      }

      case "org-schema-domain-alignment": {
        if (orgUrls.length > 0) {
          const misaligned = orgUrls.filter((u) => {
            const h = normalizeHost(u);
            return h && h !== rootHost;
          });
          if (misaligned.length > 0) {
            failed = true;
            detail = `Organization schema URLs point to domains different from "${rootHost}": ${misaligned
              .map((u) => `"${u}"`)
              .join(", ")}.`;
          }
        }
        break;
      }

      case "breadcrumb-root-consistency": {
        if (breadcrumbNodes.length > 0) {
          const roots = [];
          for (const b of breadcrumbNodes) {
            const items = b.itemListElement || [];
            if (Array.isArray(items) && items.length > 0) {
              const first = items[0];
              if (first && typeof first === "object") {
                const itemUrl =
                  first.item?.["@id"] ||
                  first.item?.url ||
                  first.item ||
                  null;
                if (itemUrl) roots.push(itemUrl);
              }
            }
          }
          const mismatched = roots.filter((u) => {
            const h = normalizeHost(u);
            return h && h !== rootHost;
          });
          if (mismatched.length > 0) {
            failed = true;
            detail = `Breadcrumb root points to domains different from "${rootHost}": ${mismatched
              .map((u) => `"${u}"`)
              .join(", ")}.`;
          }
        }
        break;
      }

      case "social-entity-consistency": {
        if (socialCandidates.length > 0) {
          // For v0 we mainly check that we don't see *multiple unrelated* brand hosts
          const hosts = new Set();
          socialCandidates.forEach((u) => {
            const h = normalizeHost(u);
            if (h) hosts.add(h);
          });
          if (hosts.size > 4) {
            failed = true;
            detail = `Social/entity links span many distinct hosts (${hosts.size}), suggesting fragmented identity.`;
          }
        }
        break;
      }

      case "minimum-identity-signals": {
        const min = c.logic.minSignals ?? 1;

        const hasOrg = orgNodes.length > 0;
        const hasBreadcrumb = breadcrumbNodes.length > 0;
        const hasSocial = socialCandidates.length > 0;

        const count = [hasOrg, hasBreadcrumb, hasSocial].filter(Boolean).length;

        if (count < min) {
          failed = true;
          detail = `Only ${count} identity signals present; expected at least ${min} among Organization schema, BreadcrumbList, or social entity links.`;
        }
        break;
      }

      default:
        // Unknown logic type — ignore, but don't mark as failed.
        break;
    }

    if (failed) {
      failedConstraints.push({
        id: c.id,
        description: c.description,
        severity,
        detail,
      });
    } else {
      appliedSeverity += severity;
    }
  }

  const maxSeverity = totalSeverity || 1;
  const passedSeverity = Math.max(0, Math.min(1, appliedSeverity / maxSeverity));
  const alignmentScore = Number(passedSeverity.toFixed(3));

  // Severity index: how "bad" the violations are on average.
  const violationSeverity = failedConstraints.reduce(
    (sum, f) => sum + (f.severity || 0.5),
    0
  );
  const severityIndex =
    failedConstraints.length > 0
      ? Number(
          Math.min(1, violationSeverity / maxSeverity).toFixed(3)
        )
      : 0;

  let level = "high";
  if (alignmentScore < 0.45) level = "low";
  else if (alignmentScore < 0.75) level = "medium";

  return {
    ontologyVersion: version.version,
    ontologyLabel: version.label,
    alignmentScore,
    level,
    severityIndex,
    failedConstraints,
  };
}
