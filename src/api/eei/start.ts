// exmxc-audit/src/api/eei/start.ts
// Mock mode: accepts a URL and returns a fake jobId.
// No Railway connection yet — prepares the dashboard flow.

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url } = req.body || {};

  // Validate URL
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing 'url' in request body." });
  }

  try {
    // Validate that it's a real URL
    new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL format." });
  }

  // Mock a jobId
  const jobId = `mock-${Date.now()}`;

  // Return the mocked jobId
  return res.status(200).json({
    ok: true,
    jobId,
    message: "Mock job created (Railway not connected yet)."
  });
}
