// /lib/jobs-db.js — EEI Batch Job Store (Upstash)
// Purpose: async batch orchestration state (NOT audit logic)

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const TTL_SECONDS = 60 * 60 * 24; // 24 hours

export async function createJob(job) {
  const key = `job:${job.jobId}`;
  await redis.set(key, JSON.stringify(job), { ex: TTL_SECONDS });
  return job;
}

export async function getJob(jobId) {
  const raw = await redis.get(`job:${jobId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveJob(job) {
  await redis.set(`job:${job.jobId}`, JSON.stringify(job), {
    ex: TTL_SECONDS,
  });
}

export async function updateJob(jobId, updater) {
  const job = await getJob(jobId);
  if (!job) return null;
  const updated = updater(job);
  await saveJob(updated);
  return updated;
}

