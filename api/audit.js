import { collectAuditEvidence, publicEvidence } from "../shared/audit-contract.js";
import { assessEntityClarityV2 } from "../shared/entity-clarity-v2.js";
import { validateTarget } from "../shared/target-policy.js";

function hostnameOf(value) {
  try { return new URL(value).hostname.replace(/^www\./i, ""); }
  catch { return ""; }
}

export async function runAudit(input, dependencies = {}) {
  const validated = validateTarget(input);
  if (!validated.ok) {
    return { success: false, status: validated.status, error: validated.error };
  }

  const evidence = await collectAuditEvidence(validated.url, dependencies);
  const visibleEvidence = publicEvidence(evidence);
  const assessment = assessEntityClarityV2(evidence);

  return {
    success: true,
    url: evidence.collection.final_url || validated.url,
    hostname: hostnameOf(evidence.collection.final_url || validated.url),
    methodologyVersion: "Entity Clarity evidence v2.1-pilot",
    ...visibleEvidence,
    assessment,
    model_representation: {
      status: "not_tested",
      results: [],
      note: "No independent model-answer test was performed by this website collection request."
    }
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  try {
    const result = await runAudit(req.query?.url);
    return res.status(result.success ? 200 : (result.status || 400)).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Audit failed.",
      details: String(error?.message || error).slice(0, 300)
    });
  }
}
