import { updateJob } from "../db/jobs";
import { saveEntity } from "../db/entities";
import { getSurfaces } from "./surfaces";
import { fetchPage } from "./fetchPage";
import { runAllSignals } from "../signals";
import { computeTiers } from "../scoring/tiers";
import { computeBand } from "../scoring/band";

export async function runCrawler(jobId: string, url: string) {
  try {
    // ----------------------------------------
    // 1. Mark job as running
    // ----------------------------------------
    await updateJob(jobId, { status: "running" });

    // ----------------------------------------
    // 2. Determine pages (surfaces) to crawl
    // ----------------------------------------
    const surfaces = await getSurfaces(url);

    // Diagnostics container
    const diagnostics: any = {
      surfaces,
      pages: []
    };

    // ----------------------------------------
    // 3. Fetch HTML for each surface
    // ----------------------------------------
    const htmlBlobs: string[] = [];

    for (const surface of surfaces) {
      const page = await fetchPage(surface);

      diagnostics.pages.push({
        url: surface,
        metadata: page.metadata || {}
      });

      htmlBlobs.push(page.html || "");
    }

    // ----------------------------------------
    // 4. Combine HTML + run signals
    // ----------------------------------------
    const combinedHTML = htmlBlobs.join("\n\n");
    const signals = await runAllSignals(combinedHTML);

    // ----------------------------------------
    // 5. Compute tiers + band
    // ----------------------------------------
    const tiers = computeTiers(signals);
    const band = computeBand(tiers);

    // ----------------------------------------
    // 6. Save entity + signals + diagnostics
    // ----------------------------------------
    const entity = await saveEntity({
      url,
      band,
      tier1: tiers.tier1,
      tier2: tiers.tier2,
      tier3: tiers.tier3,
      diagnostics,
      jobId,
      signals
    });

    // ----------------------------------------
    // 7. Mark job as done (runs in POST /jobs too)
    // ----------------------------------------
    await updateJob(jobId, {
      status: "done",
      entityId: entity.id
    });

    return entity;

  } catch (err) {
    console.error("Crawler orchestration failed:", err);
    await updateJob(jobId, { status: "error" });
    throw err;
  }
}
