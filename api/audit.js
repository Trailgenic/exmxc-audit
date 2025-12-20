export default async function handler(req, res) {
  try {
    const url =
      typeof req.query.url === "string" && req.query.url.length
        ? req.query.url
        : null;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing ?url parameter"
      });
    }

    // Minimal, static, known-good payload
    // This is ONLY to validate execution + UX
    const response = {
      success: true,
      eci: {
        entity: {
          name: "Placeholder Entity",
          url,
          hostname: new URL(url).hostname,
          vertical: null,
          timestamp: new Date().toISOString()
        },
        eci: {
          score: 75,
          range: "60–79",
          interpretation: "Operational clarity",
          strategicPosture: "Structured",
          signalCoverage: {
            observed: 13,
            unknown: 0
          }
        },
        claritySignals: [
          "Title Precision",
          "Meta Description Integrity",
          "Canonical Clarity",
          "Schema Presence & Validity",
          "Organization Schema",
          "Breadcrumb Schema",
          "Author/Person Schema",
          "Social Entity Links",
          "AI Crawl Fidelity",
          "Inference Efficiency",
          "Internal Lattice Integrity",
          "External Authority Signal",
          "Brand & Technical Consistency"
        ].map(name => ({
          name,
          status: "Strong"
        }))
      },
      eei: {
        url,
        hostname: new URL(url).hostname,
        breakdown: [],
        crawlHealth: {
          wordCount: 0,
          linkCount: 0,
          schemaCount: 0,
          jsonLdErrorCount: 0
        },
        timestamp: new Date().toISOString()
      }
    };

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Internal error"
    });
  }
}
