import type { VercelRequest, VercelResponse } from '@vercel/node';
import { railwayClient } from "@/lib/railwayClient";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // TODO: Validate jobId
  // TODO: Call Railway GET /jobs/:jobId
  // TODO: Return publicResult
}

