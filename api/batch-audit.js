// api/batch-audit.js
import axios from "axios";

/** ---- tiny promise pool (no deps) ---- */
async function withPool(tasks, limit = 5) {
  const results = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const cur = i++;
      try {
        results[cur] = await tasks[cur]();
      } catch (e) {
        results[cur] = { error: e?.message || String(e) };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** ---- CSV helper ---- */
function toCSV(rows) {
  const headers = [
    "input",
    "finalUrl",
    "hostname",
    "title",
    "entityName",
    "entityScore",
    "entityTier",
    "canonical",
    "latestISO",
    "error",
  ];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(r.input),
        esc(r.finalUrl),
        esc(r.hostname),
        esc(r.title),
        esc(r.entityName),
        esc(r.entityScore),
        esc(r.entityTier),
        esc(r.canonical),
        esc(r.latestISO),
        esc(r.error),
      ].join(",")
    );
  }
  return lines.join("\n");
}

export default async function handler(req, res) {
  // ---- CORS (universal + safe) ----
  const origin = req.headers.origin || req.headers.referer || "*";
  res.setHeader("Access-Control-Allow-Origin", origin !== "*" ? origin : "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (origin !== "*") res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST { urls: string[] }" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    let urls = Array.isArray(body.urls) ? body.urls : [];

    // Also allow ?urls=comma,separated as a convenience
    if (!urls.length && typeof req.query.urls === "string") {
      urls = req.query.urls.split(",").map((s) => s.trim()).filter(Boolean);
    }

    if (!urls.length) {
      return res.status(400).json({ error: "Provide { urls: string[] }" });
    }
    if (urls.length > 100) {
      return res.status(400).json({ error: "Max 100 URLs per batch" });
    }

    // Build same-host endpoint to reuse /api/audit
    const scheme = (req.headers["x-forwarded-proto"] || "https").toString();
    const host = (req.headers.host || "").toString();
    const auditBase = `${scheme}://${host}/api/audit`;

    const tasks = urls.map((input) => async () => {
      const target = input.startsWith("http") ? input : `https://${input}`;
      const endpoint = `${auditBase}?url=${encodeURIComponent(target)}`;
      try {
        const r = await axios.get(endpoint, {
          timeout: 20000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; exmxc-batch/1.0; +https://exmxc.ai)",
            Accept: "application/json",
          },
          validateStatus: (s) => s >= 200 && s < 500,
        });

        if (r.status >= 400) {
          return {
            input,
            error: `audit endpoint ${r.status}`,
          };
        }

        const d = r.data || {};
        return {
          input,
          finalUrl: d.url || target,
          hostname: d.hostname || "",
          title: d.title || "",
          entityName: d.entityName || "",
          entityScore: d.entityScore ?? null,
          entityTier: d.entityTier || "",
          canonical: d.canonical || "",
          latestISO: (d.schemaMeta && d.schemaMeta.latestISO) || "",
          error: null,
          raw: d, // keep full payload for debugging if needed
        };
      } catch (e) {
        return {
          input,
          error: e?.message || "request failed",
        };
      }
    });

    const results = await withPool(tasks, 6);
    const ok = results.filter((r) => !r.error && typeof r.entityScore === "number");
    const csv = toCSV(results);

    const summary = {
      total: results.length,
      succeeded: ok.length,
      failed: results.length - ok.length,
      avgScore:
        ok.length > 0
          ? Math.round((ok.reduce((a, b) => a + (b.entityScore || 0), 0) / ok.length) * 10) / 10
          : null,
      tiers: ok.reduce((acc, r) => {
        const t = r.entityTier || "Unknown";
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {}),
    };

    return res.status(200).json({
      success: true,
      summary,
      results,
      csv, // you can write this directly to a file client-side
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: "batch error",
      details: err?.message || String(err),
    });
  }
}

