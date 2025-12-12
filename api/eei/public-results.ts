// api/eei/public-result.ts
// GET /api/eei/public-result?jobId=...
// Temporary mock endpoint until Railway integration is finished

import { NextRequest, NextResponse } from "next/server";

// --- MOCK DATA ---
// This mirrors what the real Railway crawler will return.
const mock = {
  jobId: "mock-job-123",
  status: "completed",
  url: "https://example.com",
  score: 72,
  band: "Structured Entity",
  tier: {
    stage: "🌕 Structured Entity",
    verb: "Expand",
    description: "AI reconstructs identity reliably.",
  },
  signals: [
    { key: "Internal Lattice Integrity", points: 12, max: 20 },
    { key: "External Authority Signal", points: 6, max: 6 },
    { key: "AI Crawl Fidelity", points: 8, max: 8 },
    { key: "Schema Presence", points: 10, max: 10 },
    { key: "Organization Schema", points: 5, max: 5 },
    { key: "Breadcrumb Schema", points: 3, max: 3 },
    { key: "Title Precision", points: 4, max: 4 },
    { key: "Meta Description Integrity", points: 4, max: 4 }
  ],
  diagnostics: {
    internalLinks: { internal: 14, total: 22, ratio: 0.63 },
    externalLinks: ["linkedin.com", "github.com"],
    schemaCount: 3,
    title: "Example — AI-Optimized Entity",
  }
};

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json(
      { error: "Missing jobId parameter" },
      { status: 400 }
    );
  }

  // For now: return mock data regardless of jobId.
  // Later: fetch from Railway → DB → Job → Signals → Tiers → Return
  return NextResponse.json({
    requestedJobId: jobId,
    ...mock
  });
}
