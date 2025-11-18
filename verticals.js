import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

// Load the list of vertical names
export function getVerticalList() {
  const verticalsPath = path.join(DATA_DIR, "verticals.json");
  const raw = fs.readFileSync(verticalsPath, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed.verticals || [];
}

// Load all vertical definitions
export function getAllVerticals() {
  const verticalNames = getVerticalList();
  const verticals = {};

  verticalNames.forEach((v) => {
    const filePath = path.join(DATA_DIR, `${v}.json`);

    // Skip non-existent definitions
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ Missing vertical JSON: ${v}.json`);
      return;
    }

    // Skip known ignored files
    if (v === "drift-history") return;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      verticals[v] = JSON.parse(raw);
    } catch (err) {
      console.error(`Error loading vertical ${v}:`, err);
    }
  });

  return verticals;
}

// Helper to load a single vertical by name
export function getVertical(name) {
  const filePath = path.join(DATA_DIR, `${name}.json`);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ Vertical not found: ${name}`);
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error loading ${name}:`, err);
    return null;
  }
}
