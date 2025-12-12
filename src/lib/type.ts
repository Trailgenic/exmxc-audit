export interface JobStartResponse {
  jobId: string;
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

export interface InternalResult {
  entityId: string;
  diagnostics: any; // TODO: refine later
}

