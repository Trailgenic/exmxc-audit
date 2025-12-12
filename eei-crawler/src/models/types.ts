// eei-crawler/src/models/types.ts

export interface Job {
  id: string;
  url: string;
  status: "pending" | "running" | "done" | "error";
}

export interface SignalResult {
  name: string;
  score: number;
  max: number;
  notes: string;
  raw?: any;
}

export interface PublicResult {
  url: string;
  tiers: {
    tier1: number;
    tier2: number;
    tier3: number;
  };
  band: string;
}

export interface Diagnostic {
  raw: any;
  surfaces: string[];
}

export interface InternalResult {
  entityId: string;
  diagnostics: Diagnostic;
}
