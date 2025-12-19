// /api/audit-batch.js
// EEI Batch Orchestrator — Lite → Heavy Promotion Pipeline
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

  // Require at least ONE strong structural signal
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

  try {
    const verticalSlug = req.query?.vertical;
    if (!verticalSlug) {
      return res.status(400).json({
        success: false,
        error: "Missing ?vertical parameter",
      });
    }

    /* ========================================================
       1) LOAD DATASET
       ======================================================== */

    const dataset = loadVerticalFile(verticalSlug);
    if (!dataset || !Array.isArray(dataset.urls)) {
      return res.status(404).json({
        success: false,
        error: "Vertical not found or invalid format",
      });
    }

    const liteResults = [];
    const heavyResults = [];

    /* ========================================================
       2) LITE CRAWL LOOP
       ======================================================== */

    for (const url of dataset.urls) {
      try {
        const liteResp = await axios.post(
          `${CRAWL_LITE_BASE}/crawl-lite`,
          { url },
          { timeout: 15000 }
        );

        const lite = liteResp.data;
        liteResults.push(lite);

        /* ====================================================
           3) PROMOTION CHECK
           ==================================================== */

        if (shouldPromote(lite)) {
          try {
            const heavyResp = await axios.get(AUDIT_BASE, {
              params: { url },
              timeout: 30000,
            });

            heavyResults.push(heavyResp.data);
          } catch (heavyErr) {
            heavyResults.push({
              url,
              success: false,
              error: "heavy-audit-failed",
            });
          }
        }
      } catch (liteErr) {
        liteResults.push({
          url,
          success: false,
          error: "lite-crawl-failed",
        });
      }
    }

    /* ========================================================
       4) RESPONSE
       ======================================================== */

    return res.status(200).json({
      success: true,
      vertical: dataset.vertical,
      description: dataset.description,
      totals: {
        urls: dataset.urls.length,
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

