const SOCIAL_HOSTS = [
  "linkedin.com", "youtube.com", "facebook.com", "instagram.com",
  "x.com", "twitter.com", "wikipedia.org", "wikidata.org"
];

const RELATIONSHIP_KEYS = [
  "parentOrganization", "subOrganization", "brand", "founder",
  "memberOf", "department", "owns", "affiliation"
];

const DIMENSIONS = [
  { id: "identity_resolution", label: "Identity resolution", weight: 25 },
  { id: "entity_consistency", label: "Entity consistency", weight: 25 },
  { id: "relationship_clarity", label: "Relationship clarity", weight: 15 },
  { id: "evidence_traceability", label: "Evidence traceability", weight: 15 },
  { id: "machine_legibility", label: "Machine legibility", weight: 20 }
];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function typesOf(node) {
  return asArray(node?.["@type"]).map(value => String(value).toLowerCase());
}

function isEntityNode(node) {
  return typesOf(node).some(type => type.endsWith("organization") || ["corporation", "localbusiness", "brand"].includes(type));
}

function absoluteUrl(value, base) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  try { return new URL(value, base); }
  catch { return null; }
}

function sameOrigin(value, base) {
  const parsed = absoluteUrl(value, base);
  const reference = absoluteUrl(base);
  return Boolean(parsed && reference && parsed.origin === reference.origin);
}

function findInstitutionalLink(links, matcher) {
  return links.find(link => matcher.test(`${link.href} ${link.text}`.toLowerCase())) || null;
}

function tokens(value) {
  const stop = new Set(["home", "official", "site", "website", "news", "latest", "welcome", "company", "group", "inc", "llc", "ltd"]);
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter(token => token.length >= 3 && !stop.has(token)));
}

function namesAgree(visibleValues, structuredValues) {
  const visibleSets = visibleValues.map(tokens).filter(set => set.size);
  const structuredSets = structuredValues.map(tokens).filter(set => set.size);
  return visibleSets.some(visible =>
    structuredSets.some(structured => [...visible].some(token => structured.has(token)))
  );
}

function signal(id, label, max, passed, evidence) {
  return {
    id,
    label,
    status: passed ? "present" : "absent",
    points: passed ? max : 0,
    max,
    evidence: evidence || null
  };
}

function dimension(definition, signals) {
  const points = signals.reduce((sum, item) => sum + item.points, 0);
  const maximum = signals.reduce((sum, item) => sum + item.max, 0);
  return {
    label: definition.label,
    weight: definition.weight,
    status: "measured",
    score: maximum ? Number((100 * points / maximum).toFixed(2)) : null,
    weighted_points: points,
    max_points: maximum,
    signals
  };
}

function unassessableAssessment(fetchStatus) {
  return {
    methodology: "Automated Entity Clarity v2.1 pilot",
    methodology_status: "experimental",
    assessment_mode: "automated_deterministic",
    status: "unassessable",
    score_meaning: "Structural identity clarity observed in delivered static HTML; not model trust, citation, recommendation, factual correctness, or corporate intent.",
    score: null,
    comparable: false,
    coverage: { measured: 0, total: DIMENSIONS.length, percent: 0 },
    dimensions: Object.fromEntries(DIMENSIONS.map(item => [item.id, {
      label: item.label, weight: item.weight, status: "unassessable", score: null,
      weighted_points: null, max_points: item.weight, signals: []
    }])),
    evidence_basis: {
      collection_status: fetchStatus,
      surface: "homepage",
      mode: "static",
      note: "No score is produced when usable homepage HTML is not delivered."
    }
  };
}

export function assessEntityClarityV2(evidence = {}) {
  const extracted = evidence.extracted;
  const fetchStatus = evidence.collection?.fetch_status || "unknown";
  if (fetchStatus !== "delivered" || !extracted) return unassessableAssessment(fetchStatus);

  const finalUrl = evidence.collection.final_url || evidence.collection.requested_url;
  const entityNodes = extracted.schemaObjects.filter(isEntityNode);
  const links = (extracted.linkDetails || []).map(link => ({
    href: absoluteUrl(link.href, finalUrl)?.toString() || String(link.href || ""),
    text: String(link.text || "").trim()
  }));
  const aboutLink = findInstitutionalLink(links, /\babout(?:-us)?\b|who-we-are|our-company/);
  const contactLink = findInstitutionalLink(links, /\bcontact(?:-us)?\b|customer-service|help-center/);
  const standardsLink = findInstitutionalLink(links, /editorial|standards|ethics|press-room|newsroom|corporate-governance|legal/);
  const sameAs = entityNodes.flatMap(node => asArray(node.sameAs)).filter(Boolean);
  const relationships = entityNodes.flatMap(node => RELATIONSHIP_KEYS.filter(key => node?.[key]).map(key => key));
  const externalIdentityLink = links.find(link => {
    const parsed = absoluteUrl(link.href, finalUrl);
    return parsed && SOCIAL_HOSTS.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  });
  const schemaIdentityUrl = entityNodes.flatMap(node => [node?.url, node?.["@id"]]).filter(Boolean).find(value => sameOrigin(value, finalUrl));
  const title = extracted.title || "";
  const h1 = extracted.h1 || "";
  const entityName = entityNodes.map(node => node?.name).find(Boolean) || "";
  const ogName = extracted.og_site_name || extracted.og_title || "";
  const directives = [...(evidence.collection.x_robots_tag || []), ...(extracted.meta_robots || [])];
  const definitions = Object.fromEntries(DIMENSIONS.map(item => [item.id, item]));

  const dimensions = {
    identity_resolution: dimension(definitions.identity_resolution, [
      signal("title_present", "Page title is present", 5, Boolean(title), title || null),
      signal("h1_present", "Primary heading is present", 5, Boolean(h1), h1 || null),
      signal("entity_schema_named", "Named entity schema is present", 10, Boolean(entityName), entityName || null),
      signal("about_surface_discoverable", "About or company surface is discoverable", 5, Boolean(aboutLink), aboutLink?.href)
    ]),
    entity_consistency: dimension(definitions.entity_consistency, [
      signal("canonical_same_origin", "Canonical URL resolves to the audited origin", 10, sameOrigin(extracted.canonical_href, finalUrl), extracted.canonical_href),
      signal("open_graph_url_same_origin", "Open Graph URL resolves to the audited origin", 5, sameOrigin(extracted.og_url, finalUrl), extracted.og_url),
      signal("schema_identifier_same_origin", "Entity schema identifier resolves to the audited origin", 5, Boolean(schemaIdentityUrl), schemaIdentityUrl),
      signal("visible_schema_name_agreement", "Visible and structured names share an identifying token", 5, namesAgree([title, h1], [entityName, ogName]), [title, h1, entityName, ogName].filter(Boolean))
    ]),
    relationship_clarity: dimension(definitions.relationship_clarity, [
      signal("same_as_declared", "Entity schema declares external identity references", 5, sameAs.length > 0, sameAs.slice(0, 5)),
      signal("relationships_declared", "Entity schema declares organizational relationships", 5, relationships.length > 0, [...new Set(relationships)]),
      signal("identity_profile_linked", "Homepage links to a recognized external identity profile", 5, Boolean(externalIdentityLink), externalIdentityLink?.href)
    ]),
    evidence_traceability: dimension(definitions.evidence_traceability, [
      signal("description_present", "Institutional description is present", 4, Boolean(extracted.description), extracted.description || null),
      signal("about_link_present", "About or company evidence is linked", 4, Boolean(aboutLink), aboutLink?.href),
      signal("contact_link_present", "Contact or help evidence is linked", 3, Boolean(contactLink), contactLink?.href),
      signal("standards_link_present", "Standards, newsroom, governance, or legal evidence is linked", 4, Boolean(standardsLink), standardsLink?.href)
    ]),
    machine_legibility: dimension(definitions.machine_legibility, [
      signal("html_language_declared", "HTML language is declared", 4, Boolean(extracted.html_lang), extracted.html_lang || null),
      signal("canonical_present", "Canonical link is present", 4, Boolean(extracted.canonical_href), extracted.canonical_href),
      signal("jsonld_present", "Valid JSON-LD is present", 4, extracted.schemaObjects.length > 0, extracted.schemaObjects.length),
      signal("open_graph_identity_present", "Open Graph identity fields are present", 4, Boolean((extracted.og_title || extracted.og_site_name) && extracted.og_url), {
        title: extracted.og_title || null, site_name: extracted.og_site_name || null, url: extracted.og_url || null
      }),
      signal("indexable", "No noindex directive was observed", 4, !directives.includes("noindex") && !directives.includes("none"), directives)
    ])
  };

  const score = Number(Object.values(dimensions).reduce((sum, item) => sum + item.weighted_points, 0).toFixed(2));
  return {
    methodology: "Automated Entity Clarity v2.1 pilot",
    methodology_status: "experimental",
    assessment_mode: "automated_deterministic",
    status: "scored",
    score_meaning: "Structural identity clarity observed in delivered static HTML; not model trust, citation, recommendation, factual correctness, or corporate intent.",
    score,
    comparable: true,
    coverage: { measured: DIMENSIONS.length, total: DIMENSIONS.length, percent: 100 },
    dimensions,
    evidence_basis: {
      collection_status: fetchStatus,
      surface: "homepage",
      mode: "static",
      content_sha256: evidence.collection.content_sha256,
      limitations: "Measures explicit homepage signals only. Missing signals score zero after successful delivery; failed or unsupported collection remains unassessable."
    }
  };
}
