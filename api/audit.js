export default async function handler(req, res) {
  const targetUrl = req.query.url;

  // Step 1: basic validation
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: "Missing or invalid URL" });
  }

  try {
    // Step 2: simulate a real browser (bypass most bot firewalls)
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });

    // Step 3: ensure we got valid HTML
    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch: ${response.statusText}`,
      });
    }

    const html = await response.text();
    if (!html || html.trim().length < 50) {
      throw new Error("Empty or blocked HTML response");
    }

    // Step 4: extract basic metadata
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const canonicalMatch = html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    );
    const descriptionMatch = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    );

    // Step 5: count JSON-LD blocks (schema entities)
    const schemaMatches = html.match(/application\/ld\+json/gi) || [];
    const schemaCount = schemaMatches.length;

    // Step 6: generate a simple entity "trust score"
    const entityScore = Math.min(schemaCount * 20, 100);

    // Step 7: format response
    const result = {
      url: targetUrl,
      title: titleMatch ? titleMatch[1].trim() : "N/A",
      canonical: canonicalMatch ? canonicalMatch[1].trim() : targetUrl,
      description: descriptionMatch
        ? descriptionMatch[1].trim()
        : "No meta description found.",
      schemaCount,
      entityScore,
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("Audit error:", err);
    return res.status(500).json({ error: err.message });
  }
}
