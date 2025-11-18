import { getDriftHistory } from "../lib/drift-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    const vertical = req.query.vertical?.toLowerCase();

    if (!vertical) {
      return res.status(400).json({
        error: "Missing ?vertical parameter"
      });
    }

    const history = await getDriftHistory(vertical);

    return res.status(200).json({
      success: true,
      vertical,
      count: history.length,
      history
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to fetch drift history",
      details: err.message
    });
  }
}
