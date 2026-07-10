import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const connectorEvidenceQueue = new Queue('connector-evidence-collection', {
  connection: {
    url: redisUrl,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: 100, // keep the last 100 failed jobs for inspection
  },
});

// Placeholder for future worker (Phase 4 Part 2):
// The worker will process jobs from this queue, assume AWS role,
// gather compliance evidence, and save it to the DB and MinIO.
