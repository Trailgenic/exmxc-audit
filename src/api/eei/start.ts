import type { VercelRequest, VercelResponse } from '@vercel/node';
import { railwayClient } from "@/lib/railwayClient";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // TODO: Validate input
  // TODO: Call Railway POST /jobs
  // TODO: Return jobId
}

