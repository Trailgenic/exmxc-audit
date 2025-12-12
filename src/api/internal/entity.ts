import type { VercelRequest, VercelResponse } from '@vercel/node';
import { railwayClient } from "@/lib/railwayClient";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // TODO: Validate entityId
  // TODO: Call Railway GET /entities/:id (later)
  // TODO: Return internal EEI details (tiers + 13 signals + diagnostics)
}

