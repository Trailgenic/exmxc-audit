import { prisma } from "./client";

export async function createJob(url: string) {
  const job = await prisma.job.create({
    data: {
      url,
      status: "pending"
    }
  });

  return job;
}

export async function updateJob(jobId: string, data: any) {
  const job = await prisma.job.update({
    where: { id: jobId },
    data
  });

  return job;
}

export async function getJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      entity: true // So /jobs/:jobId can return publicResult
    }
  });

  return job;
}
