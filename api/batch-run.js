import fs from "node:fs/promises";
import path from "node:path";
import { runAudit } from "./audit.js";

const MAX_BATCH_SIZE = 50;
const CALIBRATION_MINIMUM_SAMPLE = 10;
const CEILING_SCORE = 90;
const CEILING_WATCH_PERCENT = 40;
const SIGNAL_SATURATION_PERCENT = 85;
const SCORE_BINS = [
  { label: "0–19", minimum: 0, maximum: 19.999 },
  { label: "20–39", minimum: 20, maximum: 39.999 },
  { label: "40–59", minimum: 40, maximum: 59.999 },
  { label: "60–79", minimum: 60, maximum: 79.999 },
  { label: "80–89", minimum: 80, maximum: 89.999 },
  { label: "90–94", minimum: 90, maximum: 94.999 },
  { label: "95–100", minimum: 95, maximum: 100 }
];

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

function percentage(numerator, denominator) {
  return denominator ? Number((100 * numerator / denominator).toFixed(2)) : null;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : Number(((ordered[middle - 1] + ordered[middle]) / 2).toFixed(2));
}

function calibrationSummary(successful, scored) {
  const scores = scored.map(result => result.assessment.score);
  const dimensionRows = {};
  const signalRows = new Map();
  const adequacy = { adequate: 0, limited: 0, unassessable: 0 };

  for (const result of successful) {
    const status = result.assessment?.content_adequacy?.status || "unassessable";
    adequacy[status] = (adequacy[status] || 0) + 1;
  }

  for (const result of scored) {
    for (const [dimensionId, dimension] of Object.entries(result.assessment?.dimensions || {})) {
      if (dimension?.status !== "measured" || typeof dimension.score !== "number") continue;
      const row = dimensionRows[dimensionId] || {
        label: dimension.label,
        weight: dimension.weight,
        measured_entities: 0,
        total_score: 0
      };
      row.measured_entities++;
      row.total_score += dimension.score;
      dimensionRows[dimensionId] = row;

      for (const signal of dimension.signals || []) {
        const signalRow = signalRows.get(signal.id) || {
          id: signal.id,
          label: signal.label,
          dimension: dimensionId,
          observed: 0,
          present: 0,
          max_points: signal.max
        };
        signalRow.observed++;
        if (signal.status === "present") signalRow.present++;
        signalRows.set(signal.id, signalRow);
      }
    }
  }

  const dimensionAverages = Object.fromEntries(Object.entries(dimensionRows).map(([id, row]) => [id, {
    label: row.label,
    weight: row.weight,
    measured_entities: row.measured_entities,
    average_score: Number((row.total_score / row.measured_entities).toFixed(2))
  }]));
  const signalPrevalence = [...signalRows.values()].map(row => ({
    id: row.id,
    label: row.label,
    dimension: row.dimension,
    observed: row.observed,
    present: row.present,
    prevalence_percent: percentage(row.present, row.observed),
    max_points: row.max_points
  }));
  const saturatedSignals = signalPrevalence
    .filter(row => row.prevalence_percent >= SIGNAL_SATURATION_PERCENT)
    .map(row => row.id);
  const ceilingCount = scores.filter(score => score >= CEILING_SCORE).length;
  const ceilingPercent = percentage(ceilingCount, scores.length);
  const enoughData = scores.length >= CALIBRATION_MINIMUM_SAMPLE;

  return {
    version: "entity-clarity-calibration/1.0",
    population: {
      scored: scores.length,
      minimum_for_flags: CALIBRATION_MINIMUM_SAMPLE
    },
    median_entity_clarity_score: median(scores),
    score_distribution: SCORE_BINS.map(bin => {
      const count = scores.filter(score => score >= bin.minimum && score <= bin.maximum).length;
      return {
        label: bin.label,
        count,
        percent_of_scored: percentage(count, scores.length)
      };
    }),
    dimension_averages: dimensionAverages,
    signal_prevalence: signalPrevalence,
    content_adequacy: adequacy,
    flags: {
      ceiling_concentration: {
        status: !enoughData ? "insufficient_sample" : ceilingPercent >= CEILING_WATCH_PERCENT ? "watch" : "not_triggered",
        threshold_score: CEILING_SCORE,
        trigger_percent: CEILING_WATCH_PERCENT,
        observed_count: ceilingCount,
        observed_percent: ceilingPercent
      },
      signal_saturation: {
        status: !enoughData ? "insufficient_sample" : saturatedSignals.length ? "watch" : "not_triggered",
        trigger_percent: SIGNAL_SATURATION_PERCENT,
        signals: enoughData ? saturatedSignals : []
      }
    },
    interpretation_boundary: "Calibration diagnostics identify concentration and common signals. They do not alter Entity Clarity v2.1 scores or create performance bands."
  };
}

export function summarizeResults(results, totalUrls) {
  const successful = results.filter(result => result.success);
  const scored = successful.filter(result => typeof result.assessment?.score === "number");
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
    scored: scored.length,
    unscored: successful.length - scored.length,
    average_entity_clarity_score: scored.length
      ? Number((scored.reduce((sum, result) => sum + result.assessment.score, 0) / scored.length).toFixed(2))
      : null,
    legacy_scored: legacyScored.length,
    average_legacy_score: legacyScored.length
      ? Number((legacyScored.reduce((sum, result) => sum + result.legacy_diagnostic.score, 0) / legacyScored.length).toFixed(2))
      : null,
    collection_status: collection,
    declared_access_posture: access,
    calibration: calibrationSummary(successful, scored)
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
    contract_version: "entity-clarity-batch/2.1-pilot",
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
