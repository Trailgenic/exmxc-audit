import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as cheerio from "cheerio";
import { runAudit } from "../api/audit.js";
import { normalizeResult, summarizeResults } from "../api/batch-run.js";
import { assessEntityClarityV2, ECV2_CHECKS } from "../shared/entity-clarity-v2.js";
import { evaluateRobots, parseRobots, providerPolicyMatrix } from "../shared/robots-policy.js";
import { fetchPublicUrl, isPublicAddress, resolvePublicHost, validateTarget } from "../shared/target-policy.js";
import { scoreAICrawlSignals } from "../shared/scoring.js";
import predictiveHandler from "../api/predictive-audit.js";
import { publicResponse } from "../api/eei-public.js";

function response(url, status, body = "", headers = {}) {
  return { requestedUrl: url, finalUrl: url, status, body, headers, redirects: [] };
}

function fixtureFetcher({ pageStatus = 200, pageBody = "<html><head><title>Fixture Company | About</title></head><body><h1>Fixture Company</h1></body></html>", robotsStatus = 404, robotsBody = "", pageError = null, robotsError = null } = {}) {
  return async url => {
    const robots = new URL(url).pathname === "/robots.txt";
    const error = robots ? robotsError : pageError;
    if (error) throw error;
    return response(url, robots ? robotsStatus : pageStatus, robots ? robotsBody : pageBody, {
      "content-type": robots ? "text/plain" : "text/html"
    });
  };
}

test("validates public HTTPS targets and rejects local or ambiguous destinations", () => {
  assert.equal(validateTarget("exmxc.ai").url, "https://exmxc.ai/");
  for (const value of ["http://exmxc.ai", "https://user:pass@exmxc.ai", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://[fd00::1]", "https://example.com:8443"]) {
    assert.equal(validateTarget(value).ok, false, value);
  }
  for (const address of ["127.0.0.1", "10.2.3.4", "169.254.1.1", "192.168.1.1", "::1", "fd00::1", "2001:db8::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("rejects an unsafe redirect before a second request", async () => {
  let calls = 0;
  const httpGet = async url => {
    calls++;
    return { status: 302, data: "", headers: { location: "https://localhost/private" } };
  };
  await assert.rejects(fetchPublicUrl("https://exmxc.ai", { httpGet }), /Redirect rejected/);
  assert.equal(calls, 1);
});

test("rejects mixed public and private DNS answers", async () => {
  const resolver = async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.7", family: 4 }
  ];
  await assert.rejects(resolvePublicHost("exmxc.ai", resolver), /non-public address/);
});

test("robots parser applies exact groups, wildcard fallback, and longest-rule precedence", () => {
  const groups = parseRobots(`
    User-agent: *
    Disallow: /private/
    User-agent: GPTBot
    Disallow: /
    Allow: /public/
  `);
  assert.equal(evaluateRobots(groups, "GPTBot", "/private/file").decision, "disallowed");
  assert.equal(evaluateRobots(groups, "GPTBot", "/public/file").decision, "allowed");
  assert.equal(evaluateRobots(groups, "Googlebot", "/private/file").decision, "disallowed");
  assert.equal(evaluateRobots(groups, "Googlebot", "/open").decision, "allowed");
});

test("provider-purpose policy remains disaggregated", () => {
  const matrix = providerPolicyMatrix({
    targetUrl: "https://exmxc.ai/report",
    robotsStatus: "available",
    robotsText: "User-agent: GPTBot\nDisallow: /\nUser-agent: OAI-SearchBot\nAllow: /"
  });
  assert.equal(matrix.find(row => row.token === "GPTBot").decision, "disallowed");
  assert.equal(matrix.find(row => row.token === "OAI-SearchBot").decision, "allowed");
  assert.equal(matrix.find(row => row.token === "ClaudeBot").decision, "allowed");
});

test("noindex and none receive no legacy crawl points; index is token-aware", () => {
  assert.equal(scoreAICrawlSignals(cheerio.load('<meta name="robots" content="noindex,nofollow">')).points, 0);
  assert.equal(scoreAICrawlSignals(cheerio.load('<meta name="robots" content="none">')).points, 0);
  assert.equal(scoreAICrawlSignals(cheerio.load('<meta name="robots" content="index,follow">')).points, 4);
});

test("network and HTTP failures never become blocking or zero clarity scores", async () => {
  const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  const timeoutResult = await runAudit("https://exmxc.ai", { fetchPublicUrl: fixtureFetcher({ pageError: timeout }) });
  assert.equal(timeoutResult.success, true);
  assert.equal(timeoutResult.collection.fetch_status, "timeout");
  assert.equal(timeoutResult.state, "unknown");
  assert.equal(timeoutResult.ecc.score, null);
  assert.equal(timeoutResult.assessment.score, null);

  for (const status of [403, 404, 429, 500]) {
    const result = await runAudit("https://exmxc.ai", { fetchPublicUrl: fixtureFetcher({ pageStatus: status }) });
    assert.equal(result.success, true);
    assert.notEqual(result.state, "blocked", String(status));
    assert.equal(result.ecc.score, null, String(status));
    assert.equal(result.legacy_diagnostic, null, String(status));
  }
});

test("non-HTML responses remain collected evidence but are not clarity-scored", async () => {
  const fetchPublicUrl = async url => {
    const robots = new URL(url).pathname === "/robots.txt";
    return response(url, robots ? 404 : 200, robots ? "" : "%PDF fixture", { "content-type": robots ? "text/plain" : "application/pdf" });
  };
  const result = await runAudit("https://exmxc.ai", { fetchPublicUrl });
  assert.equal(result.collection.fetch_status, "unsupported_content");
  assert.equal(result.legacy_diagnostic, null);
  assert.equal(result.state, "unknown");
});

test("delivered content, declared access, review status, and model status remain separate", async () => {
  const result = await runAudit("https://exmxc.ai", {
    fetchPublicUrl: fixtureFetcher({
      robotsStatus: 200,
      robotsBody: "User-agent: GPTBot\nDisallow: /\nUser-agent: OAI-SearchBot\nAllow: /"
    })
  });
  assert.equal(result.collection.fetch_status, "delivered");
  assert.equal(result.declared_access.posture, "selective");
  assert.equal(result.state, "defensive");
  assert.equal(typeof result.legacy_diagnostic.score, "number");
  assert.equal(result.assessment.score, null);
  assert.equal(result.model_representation.status, "not_tested");
  assert.equal("body" in result.collection, false);
  assert.match(result.run_id, /^[0-9a-f-]{36}$/);
  assert.match(result.collection.content_sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.collection.collector_version, "exmxc-evidence-collector/2.0");
});

test("Entity Clarity v2 only computes a comparable score from nine evidenced checks", () => {
  const incomplete = assessEntityClarityV2({ checks: {
    entity_domain_resolution: { status: "assessed", points: 2, rationale: "Verified.", evidence: ["fixture://identity"] }
  }});
  assert.equal(incomplete.coverage.assessed, 1);
  assert.equal(incomplete.score, null);
  assert.equal(incomplete.comparable, false);

  const invalidTarget = assessEntityClarityV2({
    entity_id: "ent_fixture", target_url: "https://",
    reviewer_id: "reviewer-1", reviewed_at: "2026-09-11T00:00:00.000Z", checks: {}
  });
  assert.equal(invalidTarget.review_provenance.target_url, null);

  const checks = Object.fromEntries(ECV2_CHECKS.map((check, index) => [check.id, {
    status: "assessed",
    points: index < 6 ? 2 : 1,
    rationale: "Reviewed fixture.",
    evidence: [`fixture://${check.id}`]
  }]));
  const complete = assessEntityClarityV2({
    entity_id: "ent_fixture", target_url: "https://exmxc.ai/",
    reviewer_id: "reviewer-1", reviewed_at: "2026-09-11T00:00:00.000Z", checks
  });
  assert.equal(complete.coverage.assessed, 9);
  assert.equal(complete.score, 83.33);
  assert.equal(complete.comparable, true);

  checks.entity_domain_resolution = { status: "assessed", points: 2, rationale: "Missing evidence.", evidence: [] };
  const invalid = assessEntityClarityV2({
    entity_id: "ent_fixture", target_url: "https://exmxc.ai/",
    reviewer_id: "reviewer-1", reviewed_at: "2026-09-11T00:00:00.000Z", checks
  });
  assert.equal(invalid.checks[0].status, "unassessable");
  assert.equal(invalid.score, null);
});

test("single and batch contracts count the same observation honestly", async () => {
  const raw = await runAudit("https://exmxc.ai", { fetchPublicUrl: fixtureFetcher() });
  const normalized = normalizeResult(raw);
  const summary = summarizeResults([normalized], 1);
  assert.equal(normalized.collection.fetch_status, raw.collection.fetch_status);
  assert.equal(summary.completed_observations, 1);
  assert.equal(summary.unassessed, 1);
  assert.equal(summary.legacy_scored, 1);
  assert.equal(summary.collection_status.delivered, 1);
});

test("public response exposes the versioned evidence contract without compatibility fields", async () => {
  const raw = await runAudit("https://exmxc.ai", { fetchPublicUrl: fixtureFetcher() });
  const published = publicResponse(raw);
  assert.equal(published.methodology, "Entity Clarity evidence v2.0-pilot");
  assert.equal(published.timestamp, raw.collected_at);
  assert.equal(published.assessment.review_provenance.complete, false);
  assert.equal("entityScore" in published, false);
  assert.equal("state" in published, false);
});

test("multi-surface module imports after the crawl contract repair", async () => {
  const module = await import("../lib/multi-surface-scan.js");
  assert.equal(typeof module.multiSurfaceScan, "function");
});

test("every explicit Vercel route points to a repository file", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  for (const route of config.routes) {
    if (!route.dest?.match(/^\/(?:api|public)\//)) continue;
    assert.equal(fs.existsSync(new URL(`..${route.dest}`, import.meta.url)), true, route.dest);
  }
});

test("unsupported predictive claims are retired explicitly", async () => {
  let statusCode = null;
  let payload = null;
  const res = {
    setHeader() {},
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return this; }
  };
  await predictiveHandler({ method: "GET" }, res);
  assert.equal(statusCode, 410);
  assert.equal(payload.status, "retired_pending_validation");
});
