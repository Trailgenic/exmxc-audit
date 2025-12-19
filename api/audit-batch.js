// /api/audit-batch.js
// EEI Batch Orchestrator — Lite → Heavy Promotion Pipeline (PAGINATED)
// Reads from /data/*.json, never mutates sources

import fs from "fs";
import path from "path";
import axios from "axios";

/* ============================================================
   CONFIG
   ============================================================ */

const DATA_DIR = path.join(process.cwd(), "data");

const CRAWL_LITE_BASE =
  "https://exmxc-crawl-lite-production.up.railway.app";

const AUDIT_BASE =
  process.env.VERCEL
    ? "https://exmxc.ai/api/audit"
    : "http://localhost:3000/api/audit";

/* ============================================================
   HELPERS
   ============================================================ */

function loadVerticalFile(slug) {
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function shouldPromote(lite) {
  // Never promote failed or degraded lite crawls
  if (!lite?.success) return false;

  // Require strong structural signal
  return (
    Array.isArray(lite.schemaObjects) &&
    lite.schemaObjects.length >= 2
  );
}

/* ============================================================
   HANDLER
   ============================================================ */

export default async function handler(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const startTime = Date.now();
  const MAX_RUNTIME_MS = 240_000; // 4 minutes hard stop (safety)

  try {
    /* --------------------------------------------------------
       INPUTS
       -------------------------------------------------------- */

    const verticalSlug = req.query?.vertical;
    if (!verticalSlug) {
      return res.status(400).json({
        success: false,
        error: "Missing ?vertical parameter",
      });
    }

    const offset = parseInt(req.query.offset || "0", 10);
    const limit  = parseInt(req.query.limit  || "5", 10);

    /* --------------------------------------------------------
       LOAD DATASET
       -------------------------------------------------------- */

    const dataset = loadVerticalFile(verticalSlug);
    if (!dataset || !Array.isArray(dataset.urls)) {
      return res.status(404).json({
        success: false,
        error: "Vertical not found or invalid format",
      });
    }

    const urls = dataset.urls;
    const slice = urls.slice(offset, offset + limit);

    const liteResults = [];
    const heavyResults = [];

    /* --------------------------------------------------------
       LITE → HEAVY LOOP (PAGINATED)
       -------------------------------------------------------- */

    for (const url of slice) {
      // ---- hard time guard
      if (Date.now() - startTime > MAX_RUNTIME_MS) break;

      try {
        const liteResp = await axios.post(
          `${CRAWL_LITE_BASE}/crawl-lite`,
          { url },
          { timeout: 15000 }
        );

        const lite = liteResp.data;
        liteResults.push(lite);

        if (shouldPromote(lite)) {
          try {
            const heavyResp = await axios.get(AUDIT_BASE, {
              params: { url },
              timeout: 30000,
            });

            heavyResults.push(heavyResp.data);
          } catch {
            heavyResults.push({
              url,
              success: false,
              error: "heavy-audit-failed",
            });
          }
        }
      } catch {
        liteResults.push({
          url,
          success: false,
          error: "lite-crawl-failed",
        });
      }
    }

    /* --------------------------------------------------------
       PAGINATION METADATA
       -------------------------------------------------------- */

    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < urls.length;

    /* --------------------------------------------------------
       RESPONSE (ALWAYS JSON)
       -------------------------------------------------------- */

    return res.status(200).json({
      success: true,
      vertical: dataset.vertical,
      description: dataset.description,

      offset,
      limit,
      nextOffset,
      hasMore,

      totals: {
        totalUrls: urls.length,
        processed: slice.length,
        liteAudits: liteResults.length,
        heavyAudits: heavyResults.length,
      },

      liteResults,
      heavyResults,

      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Batch audit failed",
      details: err.message || String(err),
    });
  }
}
