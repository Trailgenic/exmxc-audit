// /app/api/audit-batch/route.js
// EEI Batch Orchestrator — App Router (Next.js)
// Lite → Heavy promotion pipeline
// Reads from /data/*.json (read-only)

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

const MAX_RUNTIME_MS = 240_000; // 4 minutes hard stop

/* ============================================================
   HELPERS
   ============================================================ */

function loadVerticalFile(slug) {
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function shouldPromote(lite) {
  // Never promote failed lite crawls
  if (!lite?.success) return false;

  // Require real structural signal
  return (
    Array.isArray(lite.schemaObjects) &&
    lite.schemaObjects.length >= 2
  );
}

/* ============================================================
   GET HANDLER (App Router)
   ============================================================ */

export async function GET(request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);

    const vertical = searchParams.get("vertical");
    if (!vertical) {
      return Response.json(
        { success: false, error: "Missing ?vertical parameter" },
        { status: 400 }
      );
    }

    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const limit  = parseInt(searchParams.get("limit")  || "8", 10);

    /* ========================================================
       LOAD DATASET
       ======================================================== */

    const dataset = loadVerticalFile(vertical);
    if (!dataset || !Array.isArray(dataset.urls)) {
      return Response.json(
        { success: false, error: "Vertical not found or invalid format" },
        { status: 404 }
      );
    }

    const urls  = dataset.urls;
    const slice = urls.slice(offset, offset + limit);

    const liteResults  = [];
    const heavyResults = [];

    /* ========================================================
       LITE → HEAVY LOOP (TIME GUARDED)
       ======================================================== */

    for (const url of slice) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) break;

      try {
        const liteResp = await axios.post(
          `${CRAWL_LITE_BASE}/crawl-lite`,
          { url },
          { timeout: 15_000 }
        );

        const lite = liteResp.data;
        liteResults.push(lite);

        if (shouldPromote(lite)) {
          try {
            const heavyResp = await axios.get(AUDIT_BASE, {
              params: { url },
              timeout: 30_000,
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

    /* ========================================================
       RESPONSE
       ======================================================== */

    const nextOffset = offset + slice.length;
    const hasMore    = nextOffset < urls.length;

    return Response.json({
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
    return Response.json(
      {
        success: false,
        error: "Batch audit failed",
        details: err.message || String(err),
      },
      { status: 500 }
    );
  }
}
