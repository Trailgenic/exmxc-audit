// eei-crawler/src/models/types.ts

/* ============================================
   Core Entity Types for EEI Crawler System
   Fully aligned with Prisma + runCrawler flow
   ============================================ */

/**
 * A crawl job submitted from Vercel → Railway.
 */
export interface Job {
  id: string;
  url: string;
  status: "pending" | "running" | "done" | "error";
  entityId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * A single scored signal (Tier 1, Tier 2, Tier 3).
 * Each signal maps directly to a row in SignalResult table.
 */
export interface SignalResult {
  name: string;  // e.g., "Internal Lattice Integrity"
  score: number; // computed value
  max: number;   // maximum possible points
  notes: string; // diagnostic note
  raw?: any;     // additional debugging info
}

/**
 * The final output returned to external dashboards (public-result.ts).
 * This avoids exposing raw signals or diagnostics.
 */
export interface PublicResult {
  url: string;
  tiers: {
    tier1: number;
    tier2: number;
    tier3: number;
  };
  band: string; // Obscure, Bronze, Silver, Gold, Platinum, Sovereign
}

/**
 * Internal diagnostics saved into the Entity record:
 * - surfaces crawled
 * - individual page metadata
 * - any debugging information
 */
export interface Diagnostic {
  surfaces: string[];
  pages: Array<{
    url: string;
    metadata: any;
  }>;
  raw?: any;
}

/**
 * Returned from runCrawler() into internal API.
 * This includes full diagnostics + signals.
 */
export interface InternalResult {
  entityId: string;
  diagnostics: Diagnostic;
  signals: SignalResult[];
}
