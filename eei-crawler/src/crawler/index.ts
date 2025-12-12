// eei-crawler/src/crawler/index.ts
import { updateJob } from "../db/jobs";
import { saveEntity } from "../db/entities";
import { getSurfaces } from "./surfaces";
import { fetchPage } from "./fetchPage";
import { runAllSignals } from "../signals";
import { computeTiers } from "../scoring/tiers";
import { computeBand } from "../scoring/band";

export async function runCrawler(jobId: string, url: string) {
  try {
    await updateJob(jobId, { status: "running" });

    const surfaces = await getSurfaces(url);

    const diagnostics: any = {
      surfaces,
      pages: []
    };

    const htmlBlobs: string[] = [];

    for (const surface of surfaces) {
      const page = await fetchPage(surface);

      diagnostics.pages.push({
        url: surface,
        metadata: page.metadata || {}
      });

      htmlBlobs.push(page.html || "");
    }

    const combinedHTML = htmlBlobs.join("\n\n");

    // ⬇️ now includes url as context for host + links
    const signals = await runAllSignals(combinedHTML, url);

    const tiers = computeTiers(signals);
    const band = computeBand(tiers);

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
