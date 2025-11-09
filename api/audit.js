import axios from "axios";

export default async function handler(req, res) {
  // ✅ Handle preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
    return res.status(200).end();
  }

  // ✅ Always set CORS for main requests
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  try {
    const { url } = req.query;
    if (!url || typeof url !== "string" || url.trim() === "") {
      return res.status(400).json({ error: "Missing URL" });
    }

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) exmxc-audit-bot/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });

    res.status(200).json({
      success: true,
      status: response.status,
      finalUrl: response.request.res.responseUrl,
    });
  } catch (error) {
    console.error("Audit Error:", error.message);
    res.status(500).json({ error: error.message });
  }
}
