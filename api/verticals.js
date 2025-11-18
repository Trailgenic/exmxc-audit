// verticals.js — Auto-generate vertical list from /data directory
import fs from "fs/promises";
import path from "path";

async function buildVerticals() {
  const dataDir = path.join(process.cwd(), "data");

  const files = await fs.readdir(dataDir);

  // Filter only dataset json files
  const datasetFiles = files.filter((file) => {
    // ignore drift-history folder
    if (file === "drift-history") return false;

    // ignore predictive model files
    if (file.includes("predictive")) return false;

    // ignore anything not JSON
    if (!file.endsWith(".json")) return false;

    // ignore verticals.json itself to avoid recursion
    if (file === "verticals.json") return false;

    return true;
  });

  const verticals = {};

  for (const file of datasetFiles) {
    const filePath = path.join(dataDir, file);
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);

    const verticalKey = file.replace(".json", "");

    verticals[verticalKey] = {
      name: json.vertical || verticalKey,
      file: file,
      count: json.urls?.length || 0
    };
  }

  // write output
  const outPath = path.join(dataDir, "verticals.json");
  await fs.writeFile(outPath, JSON.stringify(verticals, null, 2));

  console.log("✓ verticals.json updated:");
  console.log(verticals);
}

buildVerticals().catch((err) => {
  console.error("Error building verticals.json:", err);
});
