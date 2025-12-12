import { Hono } from 'hono';

const app = new Hono();

app.post('/jobs', async (c) => {
  // TODO: Create job, trigger crawler
  return c.json({ jobId: "TODO" });
});

app.get('/jobs/:jobId', async (c) => {
  // TODO: Return job status + publicResult
  return c.json({ status: "pending" });
});

export default app;

