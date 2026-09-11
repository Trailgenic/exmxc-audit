import * as cheerio from "cheerio";
import { createHash, randomUUID } from "node:crypto";
import { fetchPublicUrl, networkErrorStatus } from "./target-policy.js";
import { declaredAccessPosture, directiveTokens, providerPolicyMatrix } from "./robots-policy.js";
import { parseJsonLdBlocks } from "./schema-extraction.js";

export const AUDIT_CONTRACT_VERSION = "entity-clarity-evidence/2.1-pilot";

function headerValue(headers, name) {
  if (!headers) return "";
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found ? String(found[1] || "") : "";
}

function httpFetchStatus(status) {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 401 || status === 403) return "access_restricted";
  if (status === 404 || status === 410) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "http_error";
}

async function collect(requestedUrl, fetcher, options) {
  try {
    const response = await fetcher(requestedUrl, options);
    return {
      requested_url: response.requestedUrl,
      final_url: response.finalUrl,
      fetch_status: httpFetchStatus(response.status),
      http_status: response.status,
      content_type: headerValue(response.headers, "content-type") || null,
      x_robots_tag: directiveTokens(headerValue(response.headers, "x-robots-tag")),
      redirects: response.redirects,
      headers: response.headers,
      body: response.body,
      content_sha256: response.body ? createHash("sha256").update(response.body).digest("hex") : null,
      error: null
    };
  } catch (error) {
    return {
      requested_url: requestedUrl,
      final_url: null,
      fetch_status: networkErrorStatus(error),
      http_status: null,
      content_type: null,
      x_robots_tag: [],
      redirects: [],
      headers: {},
      body: "",
      content_sha256: null,
      error: {
        code: String(error?.code || "ERR_FETCH"),
        message: String(error?.message || "Fetch failed.").slice(0, 300)
      }
    };
  }
}

function robotsDocumentStatus(observation) {
  if (observation.fetch_status === "delivered") return "available";
  if (["not_found", "access_restricted"].includes(observation.fetch_status)) return "unavailable";
  if (["server_error", "timeout", "dns_error", "tls_error", "network_error", "response_error"].includes(observation.fetch_status)) return "unreachable";
  return "fetch_error";
}

export async function collectAuditEvidence(targetUrl, dependencies = {}) {
  const fetcher = dependencies.fetchPublicUrl || fetchPublicUrl;
  const pageOptions = dependencies.pageOptions || {};
  const robotsOptions = { ...pageOptions, accept: "text/plain,*/*;q=0.1" };
  const robotsUrl = `${new URL(targetUrl).origin}/robots.txt`;
  const [page, robots] = await Promise.all([
    collect(targetUrl, fetcher, pageOptions),
    collect(robotsUrl, fetcher, robotsOptions)
  ]);
  if (page.fetch_status === "delivered" && page.content_type && !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(page.content_type)) {
    page.fetch_status = "unsupported_content";
  }
  const documentStatus = robotsDocumentStatus(robots);
  const policies = providerPolicyMatrix({ robotsText: robots.body, robotsStatus: documentStatus, targetUrl });

  let extracted = null;
  if (page.fetch_status === "delivered" && page.body.trim()) {
    const $ = cheerio.load(page.body);
    const schemaObjects = parseJsonLdBlocks($('script[type="application/ld+json"]').map((_, element) => $(element).text()).get());
    extracted = {
      $,
      schemaObjects,
      pageLinks: $("a[href]").map((_, element) => $(element).attr("href")).get().filter(Boolean),
      linkDetails: $("a[href]").map((_, element) => ({
        href: $(element).attr("href"),
        text: $(element).text().replace(/\s+/g, " ").trim()
      })).get().filter(link => link.href),
      title: $("title").first().text().trim(),
      description: ($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "").trim(),
      canonical_href: ($('link[rel="canonical"]').attr("href") || "").trim() || null,
      h1: $("h1").first().text().replace(/\s+/g, " ").trim() || null,
      meta_robots: directiveTokens($('meta[name="robots"]').attr("content") || ""),
      html_lang: ($("html").attr("lang") || "").trim() || null,
      og_title: ($('meta[property="og:title"]').attr("content") || "").trim() || null,
      og_site_name: ($('meta[property="og:site_name"]').attr("content") || "").trim() || null,
      og_url: ($('meta[property="og:url"]').attr("content") || "").trim() || null
    };
  }

  return {
    contract_version: AUDIT_CONTRACT_VERSION,
    run_id: dependencies.runId || randomUUID(),
    collected_at: dependencies.collectedAt || new Date().toISOString(),
    collection: {
      ...page,
      surface_type: "homepage",
      collection_mode: "static",
      collector_version: "exmxc-evidence-collector/2.0"
    },
    robots: {
      ...robots,
      surface_type: "robots",
      collection_mode: "static",
      collector_version: "exmxc-evidence-collector/2.0",
      document_status: documentStatus
    },
    declared_access: {
      source: "robots.txt",
      posture: declaredAccessPosture(policies),
      provider_purpose: policies,
      indexing_directives: {
        x_robots_tag: page.x_robots_tag,
        meta_robots: extracted?.meta_robots || []
      },
      interpretation_boundary: "Declared rules and collector delivery are observations. They do not by themselves establish corporate intent or actual provider behavior."
    },
    extracted
  };
}

function schemaSummary(objects) {
  return objects.map(object => ({
    type: object?.["@type"] ?? null,
    id: object?.["@id"] ?? null,
    name: object?.name ?? null,
    url: object?.url ?? null
  }));
}

export function publicEvidence(evidence) {
  const extracted = evidence.extracted;
  return {
    contract_version: evidence.contract_version,
    run_id: evidence.run_id,
    collected_at: evidence.collected_at,
    collection: {
      requested_url: evidence.collection.requested_url,
      final_url: evidence.collection.final_url,
      fetch_status: evidence.collection.fetch_status,
      http_status: evidence.collection.http_status,
      content_type: evidence.collection.content_type,
      surface_type: evidence.collection.surface_type,
      collection_mode: evidence.collection.collection_mode,
      collector_version: evidence.collection.collector_version,
      content_sha256: evidence.collection.content_sha256,
      x_robots_tag: evidence.collection.x_robots_tag,
      redirects: evidence.collection.redirects,
      error: evidence.collection.error
    },
    robots: {
      requested_url: evidence.robots.requested_url,
      final_url: evidence.robots.final_url,
      document_status: evidence.robots.document_status,
      surface_type: evidence.robots.surface_type,
      collection_mode: evidence.robots.collection_mode,
      collector_version: evidence.robots.collector_version,
      content_sha256: evidence.robots.content_sha256,
      fetch_status: evidence.robots.fetch_status,
      http_status: evidence.robots.http_status,
      error: evidence.robots.error
    },
    declared_access: evidence.declared_access,
    machine_evidence: extracted ? {
      title: extracted.title || null,
      description: extracted.description || null,
      h1: extracted.h1,
      canonical_href: extracted.canonical_href,
      meta_robots: extracted.meta_robots,
      html_lang: extracted.html_lang,
      open_graph: {
        title: extracted.og_title,
        site_name: extracted.og_site_name,
        url: extracted.og_url
      },
      schema: schemaSummary(extracted.schemaObjects)
    } : null
  };
}
