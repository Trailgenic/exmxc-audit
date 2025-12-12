/ lib/drift-db.js — Upstash KV (Drift History Storage)

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

/**
 * Save a drift snapshot for a vertical.
 * Automatically pushes onto a vertical-specific list.
 */
export async function saveDriftSnapshot(vertical, snapshot) {
  const key = `drift:${vertical}`;
  // push newest to head
  await redis.lpush(key, JSON.stringify(snapshot));
}

/**
 * Get full drift history for a vertical.
 */
export async function getDriftHistory(vertical) {
  const key = `drift:${vertical}`;
  const items = await redis.lrange(key, 0, -1);

  return items.map((i) => JSON.parse(i));
}
