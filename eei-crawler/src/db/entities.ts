// eei-crawler/src/db/entities.ts

/**
 * Entity Persistence Layer
 *
 * This module handles all DB operations for:
 *  - Entity records
 *  - SignalResult rows (13 signals)
 *  - Diagnostics JSON payload
 *
 * It receives final scoring output from runCrawler() and
 * stores the complete result set in relational form.
 */

import { prisma } from "./client";
import type { SignalResult } from "../models/types";

/**
 * Save a completed crawl result into the database.
 *
 * @param data {
 *   url: string
 *   band: string
 *   tier1: number
 *   tier2: number
 *   tier3: number
 *   diagnostics: any
 *   jobId: string
 *   signals: SignalResult[]
 * }
 */
export async function saveEntity(data: {
  url: string;
  band: string;
  tier1: number;
  tier2: number;
  tier3: number;
  diagnostics: any;
  jobId: string;
  signals: SignalResult[];
}) {
  // 1. Create the Entity base record
  const entity = await prisma.entity.create({
    data: {
      url: data.url,
      band: data.band,
      tier1: data.tier1,
      tier2: data.tier2,
      tier3: data.tier3,
      diagnostics: data.diagnostics, // JSON column
      job: {
        connect: { id: data.jobId }
      }
    }
  });

  // 2. Insert all signal rows (13 EEI signals)
  if (data.signals.length > 0) {
    await prisma.signalResult.createMany({
      data: data.signals.map((sig) => ({
        entityId: entity.id,
        name: sig.name,
        score: sig.score,
        details: sig.raw ?? {}
      }))
    });
  }

  return entity;
}

/**
 * Fetch full entity results (internal dashboard use)
 */
export async function getEntity(entityId: string) {
  return prisma.entity.findUnique({
    where: { id: entityId },
    include: {
      SignalResult: true
    }
  });
}
