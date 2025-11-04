import axios from "axios";

export default async function handler(req, res) {
  try {
    let { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Missing or invalid URL list" });
    }

    const normalize = (url) =>
      /^https?:\/\//i.test(url) ? url : `https://${url}`;

    const results = [];
    for (const rawUrl of urls) {
      const url = normalize(rawUrl);
      try {
        const response = await axios.get(
          `${process.env.VERCEL_URL || "https://exmxc.ai"}/api/audit`,
          { params: { url }, timeout: 20000 }
        );
        results.push({ url, ...response.data });
      } catch (err) {
        results.push({
          url,
          error: err.response?.data?.error || err.message || "Unknown error",
        });
      }
    }

    // --- Aggregate Scoring ---
    const valid = results.filter((r) => !r.error);
    const avgEntityScore =
      valid.reduce((sum, r) => sum + (r.entityScore || 0), 0) /
      (valid.length || 1);
    const avgSchemaCount =
      valid.reduce((sum, r) => sum + (r.schemaCount || 0), 0) /
      (valid.length || 1);

    // Weighted grade (for future calibration)
    const siteScore = Math.min(
      Math.round(avgEntityScore * 0.9 + avgSchemaCount * 3),
      100
    );

    res.status(200).json({
      siteScore,
      avgEntityScore: Math.round(avgEntityScore),
      avgSchemaCount: Math.round(avgSchemaCount),
      totalPages: urls.length,
      pagesAudited: valid.length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Site scan error:", err.message);
    res.status(500).json({
      error: "Failed to run site scan",
      details: err.message,
    });
  }
}
