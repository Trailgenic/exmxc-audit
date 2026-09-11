import fs from "node:fs/promises";
import path from "node:path";
import { runAudit } from "./audit.js";

const MAX_BATCH_SIZE = 50;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function normalizeResult(raw) {
  if (!raw?.success) return { success: false, url: raw?.url || null, error: raw?.error || "Audit failed." };
  return {
    success: true,
    url: raw.url,
    collection: raw.collection,
    declared_access: raw.declared_access,
    assessment: raw.assessment,
    model_representation: raw.model_representation,
    legacy_diagnostic: raw.legacy_diagnostic,
    compatibility: { state: raw.state, legacy_ecc: raw.ecc?.score ?? null }
  };
}

export function summarizeResults(results, totalUrls) {
  const successful = results.filter(result => result.success);
  const assessed = successful.filter(result => typeof result.assessment?.score === "number");
  const legacyScored = successful.filter(result => typeof result.legacy_diagnostic?.score === "number");
  const collection = {};
  const access = {};
  for (const result of successful) {
    const fetchStatus = result.collection?.fetch_status || "unknown";
    const posture = result.declared_access?.posture || "unknown";
    collection[fetchStatus] = (collection[fetchStatus] || 0) + 1;
    access[posture] = (access[posture] || 0) + 1;
  }
  return {
    total_urls_in_dataset: totalUrls,
    attempted: results.length,
    completed_observations: successful.length,
    request_errors: results.length - successful.length,
    assessed: assessed.length,
    unassessed: successful.length - assessed.length,
    legacy_scored: legacyScored.length,
    average_legacy_score: legacyScored.length
      ? Number((legacyScored.reduce((sum, result) => sum + result.legacy_diagnostic.score, 0) / legacyScored.length).toFixed(2))
      : null,
    collection_status: collection,
    declared_access_posture: access
  };
}

export async function runBatch({ dataset, start = 0, limit = MAX_BATCH_SIZE, audit = runAudit }) {
  const safeDataset = String(dataset || "core-web").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!safeDataset) throw new Error("Invalid dataset name.");
  const parsed = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", `${safeDataset}.json`), "utf8"));
  const urls = Array.isArray(parsed.urls) ? parsed.urls : [];
  const selected = urls.slice(start, start + limit);
  const results = [];
  for (const url of selected) {
    try { results.push(normalizeResult(await audit(url))); }
    catch (error) { results.push({ success: false, url, error: String(error?.message || error) }); }
  }
  return {
    success: true,
    contract_version: "entity-clarity-batch/2.0-pilot",
    vertical: parsed.vertical || safeDataset,
    dataset: safeDataset,
    window: { start, limit, returned: selected.length, next_start: start + selected.length < urls.length ? start + selected.length : null },
    summary: summarizeResults(results, urls.length),
    results,
    timestamp: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ success: false, error: "Method not allowed." });
  try {
    const start = boundedInteger(req.query?.start, 0, 0, 100_000);
    const limit = boundedInteger(req.query?.limit, 25, 1, MAX_BATCH_SIZE);
    const payload = await runBatch({ dataset: req.query?.dataset, start, limit });
    payload.persistence = { requested: false, status: "not_requested" };
    if (req.method === "POST" && req.query?.persist === "true") {
      payload.persistence.requested = true;
      const { saveDriftSnapshot } = await import("../lib/drift-db.js");
      await saveDriftSnapshot(payload.vertical, payload);
      payload.persistence.status = "saved";
    }
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ success: false, error: "Batch run failed.", details: String(error?.message || error).slice(0, 300) });
  }
}
