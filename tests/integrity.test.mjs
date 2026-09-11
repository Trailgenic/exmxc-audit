import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as cheerio from "cheerio";
import { runAudit } from "../api/audit.js";
import { normalizeResult, summarizeResults } from "../api/batch-run.js";
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

const RICH_ENTITY_HTML = `<!doctype html>
<html lang="en"><head>
  <title>Fixture Corporation</title>
  <meta name="description" content="Fixture Corporation provides institutional testing services.">
  <meta property="og:title" content="Fixture Corporation">
  <meta property="og:site_name" content="Fixture Corporation">
  <meta property="og:url" content="https://exmxc.ai/">
  <link rel="canonical" href="https://exmxc.ai/">
  <script type="application/ld+json">{
    "@context":"https://schema.org","@type":"Organization","name":"Fixture Corporation",
    "url":"https://exmxc.ai/","@id":"https://exmxc.ai/#organization",
    "sameAs":["https://www.linkedin.com/company/fixture"],
    "parentOrganization":{"@type":"Organization","name":"Fixture Parent"}
  }</script>
</head><body>
  <h1>Fixture Corporation</h1>
  <p>Fixture Corporation publishes clear institutional information for customers, partners, researchers, and the public. This calibration paragraph represents substantive static homepage text that is available without client-side rendering. It explains the organization, its work, its standards, and the evidence paths visitors can use to verify its identity. The same visible material remains present across ordinary collection runs so the adequacy flag can distinguish substantive HTML from a thin application shell. Additional context describes the institution's mission, operating scope, public responsibilities, and primary services.</p>
  <a href="/about">About us</a>
  <a href="/contact">Contact</a>
  <a href="/editorial-standards">Editorial standards</a>
  <a href="/privacy">Privacy</a>
  <a href="https://www.linkedin.com/company/fixture">LinkedIn</a>
</body></html>`;

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
  assert.equal(timeoutResult.assessment.content_adequacy.status, "unassessable");

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

test("delivered content, declared access, automated clarity, and model status remain separate", async () => {
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
  assert.equal(typeof result.assessment.score, "number");
  assert.equal(result.assessment.coverage.measured, 5);
  assert.equal(result.assessment.assessment_mode, "automated_deterministic");
  assert.equal(result.model_representation.status, "not_tested");
  assert.equal("body" in result.collection, false);
  assert.match(result.run_id, /^[0-9a-f-]{36}$/);
  assert.match(result.collection.content_sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.collection.collector_version, "exmxc-evidence-collector/2.0");
});

test("Automated Entity Clarity v2.1 computes five evidence-backed dimensions without human review", async () => {
  const complete = await runAudit("https://exmxc.ai", {
    fetchPublicUrl: fixtureFetcher({ pageBody: RICH_ENTITY_HTML })
  });
  assert.equal(complete.assessment.score, 100);
  assert.equal(complete.assessment.comparable, true);
  assert.deepEqual(complete.assessment.coverage, { measured: 5, total: 5, percent: 100 });
  assert.equal(Object.keys(complete.assessment.dimensions).length, 5);
  assert.equal(complete.assessment.dimensions.identity_resolution.signals.length, 4);
  assert.equal(complete.assessment.dimensions.machine_legibility.signals.length, 5);
  assert.equal(complete.assessment.content_adequacy.status, "adequate");
  assert.equal("review_provenance" in complete.assessment, false);

  const sparse = await runAudit("https://exmxc.ai", { fetchPublicUrl: fixtureFetcher() });
  assert.equal(sparse.assessment.status, "scored");
  assert.equal(sparse.assessment.score, 14);
  assert.equal(sparse.assessment.coverage.percent, 100);
  assert.equal(sparse.assessment.content_adequacy.status, "limited");
  assert.equal(sparse.machine_evidence.page_metrics.link_count, 0);
});

test("single and batch contracts count the same observation honestly", async () => {
  const raw = await runAudit("https://exmxc.ai", { fetchPublicUrl: fixtureFetcher() });
  const normalized = normalizeResult(raw);
  const summary = summarizeResults([normalized], 1);
  assert.equal(normalized.collection.fetch_status, raw.collection.fetch_status);
  assert.equal(summary.completed_observations, 1);
  assert.equal(summary.scored, 1);
  assert.equal(summary.unscored, 0);
  assert.equal(summary.average_entity_clarity_score, raw.assessment.score);
  assert.equal(summary.legacy_scored, 1);
  assert.equal(summary.collection_status.delivered, 1);
  assert.equal(summary.calibration.population.scored, 1);
  assert.equal(summary.calibration.flags.ceiling_concentration.status, "insufficient_sample");
});

test("batch calibration reports distributions, dimension averages, signal prevalence, and static-content adequacy", async () => {
  const complete = normalizeResult(await runAudit("https://exmxc.ai", {
    fetchPublicUrl: fixtureFetcher({ pageBody: RICH_ENTITY_HTML })
  }));
  const sparse = normalizeResult(await runAudit("https://exmxc.ai", {
    fetchPublicUrl: fixtureFetcher()
  }));
  const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  const unscored = normalizeResult(await runAudit("https://exmxc.ai", {
    fetchPublicUrl: fixtureFetcher({ pageError: timeout })
  }));
  const results = [
    ...Array.from({ length: 5 }, () => complete),
    ...Array.from({ length: 5 }, () => sparse),
    unscored
  ];
  const calibration = summarizeResults(results, results.length).calibration;

  assert.equal(calibration.population.scored, 10);
  assert.equal(calibration.median_entity_clarity_score, 57);
  assert.deepEqual(calibration.content_adequacy, { adequate: 5, limited: 5, unassessable: 1 });
  assert.equal(calibration.score_distribution.find(bin => bin.label === "0–19").count, 5);
  assert.equal(calibration.score_distribution.find(bin => bin.label === "95–100").count, 5);
  assert.equal(calibration.dimension_averages.identity_resolution.average_score, 70);
  assert.equal(calibration.signal_prevalence.find(signal => signal.id === "title_present").prevalence_percent, 100);
  assert.equal(calibration.flags.ceiling_concentration.status, "watch");
  assert.equal(calibration.flags.ceiling_concentration.observed_percent, 50);
  assert.equal(calibration.flags.signal_saturation.status, "watch");
});

test("public response exposes the versioned evidence contract without compatibility fields", async () => {
  const raw = await runAudit("https://exmxc.ai", { fetchPublicUrl: fixtureFetcher() });
  const published = publicResponse(raw);
  assert.equal(published.methodology, "Entity Clarity evidence v2.1-pilot");
  assert.equal(published.timestamp, raw.collected_at);
  assert.equal(published.assessment.assessment_mode, "automated_deterministic");
  assert.equal(typeof published.assessment.score, "number");
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
