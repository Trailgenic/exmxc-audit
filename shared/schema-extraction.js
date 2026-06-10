// /shared/schema-extraction.js
// JSON-LD extraction helpers shared by audit and crawl endpoints.

const NESTED_SCHEMA_PROPS = [
  "breadcrumb",
  "author",
  "publisher",
  "mainEntity",
  "hasPart"
];

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function flattenTopLevelJsonLd(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed?.["@graph"] && Array.isArray(parsed["@graph"])) return parsed["@graph"];
  return [parsed];
}

function hasInlineType(node) {
  return Boolean(
    node &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    node["@type"]
  );
}

export function hoistNestedSchemaObjects(schemaObjects = []) {
  const objects = Array.isArray(schemaObjects) ? [...schemaObjects] : [];
  const seenIds = new Set(
    objects
      .map(obj => obj && typeof obj === "object" ? obj["@id"] : null)
      .filter(Boolean)
  );

  for (const node of objects.slice()) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;

    for (const prop of NESTED_SCHEMA_PROPS) {
      const value = node[prop];
      if (!value) continue;

      for (const candidate of asArray(value)) {
        if (!hasInlineType(candidate)) continue;

        const id = candidate["@id"];
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);

        objects.push(candidate);
      }
    }
  }

  return objects;
}

export function parseJsonLdBlocks(blocks = []) {
  const objects = [];

  for (const raw of blocks) {
    try {
      const parsed = JSON.parse(raw);
      objects.push(...flattenTopLevelJsonLd(parsed));
    } catch {}
  }

  return hoistNestedSchemaObjects(objects);
}
