import axios from "axios";

const INTERNAL_ORIGIN = "https://exmxc-audit.vercel.app";
const INTERNAL_TIMEOUT_MS = 25_000;

export function publicResponse(audit) {
  return {
    success: true,
    methodology: audit.methodologyVersion,
    run_id: audit.run_id,
    url: audit.url,
    hostname: audit.hostname,
    collection: audit.collection,
    robots: audit.robots,
    declared_access: audit.declared_access,
    machine_evidence: audit.machine_evidence,
    assessment: audit.assessment,
    model_representation: audit.model_representation,
    legacy_diagnostic: audit.legacy_diagnostic,
    interpretation_boundary: "This response reports collected website evidence and an uncompleted review template. It does not establish model trust, citation, recommendation, or corporate intent.",
    timestamp: audit.collected_at
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });

  const input = String(req.query?.url || "").trim();
  if (!input) return res.status(400).json({ success: false, error: "Invalid or missing URL." });
  try {
    const response = await axios.get(`${INTERNAL_ORIGIN}/api/audit?url=${encodeURIComponent(input)}`, {
      timeout: INTERNAL_TIMEOUT_MS,
      headers: { Accept: "application/json", "User-Agent": "exmxc-entity-clarity-public/2.0" },
      validateStatus: status => status >= 200 && status < 500
    });
    const audit = response.data;
    if (!audit || typeof audit !== "object") throw new Error("Audit endpoint did not return JSON.");
    if (!audit.success) return res.status(response.status || 400).json(audit);
    return res.status(200).json(publicResponse(audit));
  } catch (error) {
    return res.status(502).json({ success: false, error: "Public Entity Clarity proxy failed.", details: String(error?.message || error).slice(0, 300) });
  }
}
