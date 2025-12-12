// eei-crawler/src/db/entities.ts
import { prisma } from "./client";
import { SignalResult } from "../models/types";

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
  // 1. Create Entity
  const entity = await prisma.entity.create({
    data: {
      url: data.url,
      band: data.band,
      tier1: data.tier1,
      tier2: data.tier2,
      tier3: data.tier3,
      diagnostics: data.diagnostics,
      job: {
        connect: { id: data.jobId }
      }
    }
  });

  // 2. Save all signals (Tier 1 now, later all 13)
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

export async function getEntity(entityId: string) {
  return prisma.entity.findUnique({
    where: { id: entityId },
    include: {
      SignalResult: true
    }
  });
}
