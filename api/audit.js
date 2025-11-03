export default async function handler(req, res) {
  const { url } = req.query;

  // Step 1: Validate input
  if (!url) {
    return res.status(400).json({ error: "Missing URL" });
  }

  // Step 2: Ensure full URL format
  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    target = "https://" + target;
  }

  try {
    // Step 3: Add timeout controller (10s)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    // Step 4: Fetch page HTML
    const response = await fetch(target, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(500).json({ error: `Failed to fetch page: ${response.status}` });
    }

    const html = await response.text();

    // Step 5: Extract key metadata
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "No title found";

    const descMatch = html.match(/<meta name="description" content="([^"]*)"/i);
    const description = descMatch ? descMatch[1].trim() : "No description found";

    const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/i);
    const canonical = canonicalMatch ? canonicalMatch[1].trim() : target;

    const schemaCount = (html.match(/"@context":/g) || []).length;
    const entityScore = schemaCount > 0 ? 100 : 0;

    // Step 6: Return structured result
    res.status(200).json({
      url: target,
      title,
      canonical,
      description,
      schemaCount,
      entityScore,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Audit error:", error);
    res.status(500).json({ error: "Failed to fetch or parse page" });
  }
}
