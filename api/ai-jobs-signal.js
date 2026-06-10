// /api/ai-jobs-signal.js
// Deprecated: canonical implementation lives on the exmxc-workers Cloudflare node.

const REDIRECT_TARGET = "https://mcp.exmxc.ai/api/ai-jobs-signal";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const rawUrl = req.url || "";
  const queryStart = rawUrl.indexOf("?");
  const queryString = queryStart >= 0 ? rawUrl.slice(queryStart) : "";

  res.setHeader("Location", `${REDIRECT_TARGET}${queryString}`);
  return res.status(308).end();
}
