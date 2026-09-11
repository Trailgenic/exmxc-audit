import { readFile } from "node:fs/promises";
import { assessEntityClarityV2 } from "../shared/entity-clarity-v2.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run assess:v2 -- path/to/review.json");
  process.exitCode = 1;
} else {
  try {
    const input = JSON.parse(await readFile(inputPath, "utf8"));
    process.stdout.write(`${JSON.stringify(assessEntityClarityV2(input), null, 2)}\n`);
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}
