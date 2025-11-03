// ✅ exmxc-audit/api/audit.js

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const inputUrl = searchParams.get('url');

    if (!inputUrl) {
      return new Response(JSON.stringify({ error: 'Missing URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 🛠 Auto-prefix https:// if missing
    const fullUrl = /^https?:\/\//i.test(inputUrl) ? inputUrl : `https://${inputUrl}`;

    const response = await fetch(fullUrl, { redirect: 'follow' });
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch ${fullUrl}` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const html = await response.text();

    // Extract key info
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const schemaCount = (html.match(/application\/ld\+json/g) || []).length;

    const entityScore = Math.min(schemaCount * 25, 100);

    const result = {
      url: fullUrl,
      title: titleMatch ? titleMatch[1].trim() : 'N/A',
      canonical: canonicalMatch ? canonicalMatch[1].trim() : 'N/A',
      description: descMatch ? descMatch[1].trim() : 'N/A',
      schemaCount,
      entityScore,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
