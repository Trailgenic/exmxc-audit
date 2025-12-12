// /api/verticals.js — Return the generated vertical list
import fs from "fs/promises";
import path from "path";

export default async function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), "data", "verticals.json");
    const raw = await fs.readFile(filePath, "utf8");
    const verticals = JSON.parse(raw);

    // Convert into dropdown-friendly list
    const list = Object.keys(verticals).map((key) => ({
      value: key,
      label: verticals[key].name || key
    }));

    res.status(200).json({
      success: true,
      verticals: list
    });

  } catch (err) {
    console.error("API /verticals error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to load verticals"
    });
  }
}
