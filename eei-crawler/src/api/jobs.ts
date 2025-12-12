import { Hono } from 'hono';
import { createJob, updateJob } from '../db/jobs';
import { runCrawler } from '../crawler/index';

const app = new Hono();

// ----------------------------------------------------
// POST /jobs
// Start a crawl job
// ----------------------------------------------------
app.post('/jobs', async (c) => {
  try {
    const body = await c.req.json();
    const url = body?.url;

    if (!url) {
      return c.json({ error: "Missing 'url' in request body" }, 400);
    }

    // 1. Create job in DB
    const job = await createJob(url);

    // 2. Kick off crawler asynchronously (non-blocking)
    runCrawler(job.id, url)
      .then(() => {
        updateJob(job.id, { status: "done" });
      })
      .catch(async (err) => {
        console.error("Crawler failed:", err);
        await updateJob(job.id, { status: "error" });
      });

    // 3. Return jobId immediately (fortress pattern)
    return c.json({ jobId: job.id });

  } catch (error) {
    console.error("POST /jobs error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
