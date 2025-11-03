// ✅ exmxc-audit/api/audit.js
export default async function handler(req, res) {
  try {
    // Support both GET and POST (for flexibility)
    const { url } = req.query;

    // Auto-fix missing protocol
    if (!url) {
      return res.status(400).json({ error: 'Missing URL' });
    }
    const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

    // Fetch target HTML
    const response = await fetch(fullUrl);
    if (!response.ok) {
      return res.status(response.status).json({ error: `Failed to fetch ${fullUrl}` });
    }

    const html = await response.text();

    // Extract metadata
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const schemaCount = (html.match(/application\/ld\+json/g) || []).length;

    const result = {
      url: fullUrl,
      title: titleMatch ? titleMatch[1].trim() : 'N/A',
      canonical: canonicalMatch ? canonicalMatch[1].trim() : 'N/A',
      description: descMatch ? descMatch[1].trim() : 'N/A',
      schemaCount,
      entityScore: schemaCount * 25 > 100 ? 100 : schemaCount * 25,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(result);
  } catch (error) {
    console.error('Audit error:', error);
    res.status(500).json({ error: error.message });
  }
}
