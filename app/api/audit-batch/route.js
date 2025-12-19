// /app/api/audit-batch/route.js
// EEI Batch Orchestrator — paged batch runner (lite -> promote -> heavy)

import fs from "fs";
import path from "path";
import axios from "axios";
import { NextResponse } from "next/server";

const DATA_DIR = path.join(process.cwd(), "data");

const CRAWL_LITE_BASE = "https://exmxc-crawl-lite-production.up.railway.app";

const AUDIT_BASE =
  process.env.VERCEL
    ? "https://exmxc.ai/api/audit"
    : "http://localhost:3000/api/audit";

// ---------- helpers ----------
function loadVerticalFile(slug) {
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function shouldPromote(lite) {
  if (!lite?.success) return false;
  return Array.isArray(lite.schemaObjects) && lite.schemaObjects.length >= 2;
}

function json(data, status = 200, origin = "*") {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ---------- handlers ----------
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "*";
  return json({ success: true }, 200, origin);
}

export async function GET(req) {
  const origin = req.headers.get("origin") || "*";
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 240_000; // 4 min guard

  try {
    const { searchParams } = new URL(req.url);

    const verticalSlug = searchParams.get("vertical");
    if (!verticalSlug) {
      return json({ success: false, error: "Missing ?vertical parameter" }, 400, origin);
    }

    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const limit  = parseInt(searchParams.get("limit")  || "8", 10);

    const dataset = loadVerticalFile(verticalSlug);
    if (!dataset || !Array.isArray(dataset.urls)) {
      return json({ success: false, error: "Vertical not found or invalid format" }, 404, origin);
    }

    const urls = dataset.urls;
    const slice = urls.slice(offset, offset + limit);

    const liteResults = [];
    const heavyResults = [];

    for (const url of slice) {
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
            heavyResults.push({ url, success: false, error: "heavy-audit-failed" });
          }
        }
      } catch {
        liteResults.push({ url, success: false, error: "lite-crawl-failed" });
      }
    }

    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < urls.length;

    return json({
      success: true,
      vertical: dataset.vertical || verticalSlug,
      description: dataset.description || "",
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
    }, 200, origin);

  } catch (err) {
    return json({
      success: false,
      error: "Batch audit failed",
      details: err?.message || String(err),
    }, 500, origin);
  }
}
