import { Hono } from 'hono';
import { createJob, updateJob, getJob } from '../db/jobs';
import { runCrawler } from '../crawler/index';

const app = new Hono();

// ==============================================
// POST /jobs  (already implemented previously)
// ==============================================
app.post('/jobs', async (c) => {
  try {
    const body = await c.req.json();
    const url = body?.url;

    if (!url) {
      return c.json({ error: "Missing 'url' in request body" }, 400);
    }

    // 1. Create job in DB
    const job = await createJob(url);

    // 2. Kick off crawler asynchronously
    runCrawler(job.id, url)
      .then(() => updateJob(job.id, { status: "done" }))
      .catch(async (err) => {
        console.error("Crawler failed:", err);
        await updateJob(job.id, { status: "error" });
      });

    // 3. Return jobId immediately
    return c.json({ jobId: job.id });

  } catch (error) {
    console.error("POST /jobs error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ==============================================
// GET /jobs/:jobId  (new implementation)
// ==============================================
app.get('/jobs/:jobId', async (c) => {
  try {
    const jobId = c.req.param("jobId");

    if (!jobId) {
      return c.json({ error: "Missing jobId parameter" }, 400);
    }

    const job = await getJob(jobId);

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    // If job is still running or pending → return status only
    if (job.status !== "done") {
      return c.json({
        jobId: job.id,
        status: job.status
      });
    }

    // When job is done, job.entity contains the Entity row
    const entity = job.entity;

    if (!entity) {
      return c.json({ error: "Entity not found for completed job" }, 500);
    }

    // Build publicResult for external dashboards
    const publicResult = {
      url: entity.url,
      tiers: {
        tier1: entity.tier1,
        tier2: entity.tier2,
        tier3: entity.tier3
      },
      band: entity.band
    };

    return c.json({
      jobId: job.id,
      status: job.status,
      publicResult,
      entityId: entity.id
    });

  } catch (error) {
    console.error("GET /jobs/:jobId error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
