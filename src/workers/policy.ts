/**
 * src/workers/policy.ts
 *
 * Phase 2 Feature 4 — Policy worker refactored.
 *
 * BEFORE: Queued `generate-policy` jobs that told Ollama to write legal text from scratch.
 * AFTER:  Queues `review-policy-draft` jobs that ask Ollama to AUDIT a template-rendered
 *         draft and return structured findings (gaps, conflicts, missing clauses).
 *         LLM never writes or replaces any legal text.
 *
 * The original `generate-policy` queue name is kept for backward compatibility with
 * any jobs still in Redis, but the worker now only processes review jobs.
 * Old generation jobs will be consumed and return a migration notice.
 *
 * [skills: backend-dev-guidelines]
 */

import { Worker, Queue, type Job } from "bullmq";
import { PrismaClient, PolicyType } from "@prisma/client";
import { env } from "@/env";

// ------------------------------------------------------------------
// Prisma singleton
// ------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __workerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__workerPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__workerPrisma = prisma;
}

// ------------------------------------------------------------------
// Redis helper
// ------------------------------------------------------------------

function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

// ------------------------------------------------------------------
// Phase 2: Review-only queue
// ------------------------------------------------------------------

export const REVIEW_QUEUE_NAME = "review-policy-draft";

export interface ReviewPolicyJobData {
  policyContent: string;    // the Handlebars-rendered draft text
  organizationId: string;
}

export interface PolicyFinding {
  type: "UNFILLED_VARIABLE" | "CLAUSE_CONFLICT" | "MISSING_REQUIREMENT";
  description: string;
  regulationRef?: string;   // section number from RegulationSnippet
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export const reviewPolicyQueue = new Queue<ReviewPolicyJobData>(REVIEW_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 5_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 50 },
  },
});

// ------------------------------------------------------------------
// Legacy queue (kept so old in-flight jobs drain cleanly)
// ------------------------------------------------------------------

export const POLICY_QUEUE_NAME = "generate-policy";

export interface ProcessPolicyJobData {
  policyType: PolicyType;
  context: string;
}

export const policyQueue = new Queue<ProcessPolicyJobData>(POLICY_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 20 },
  },
});

// ------------------------------------------------------------------
// Ollama helpers
// ------------------------------------------------------------------

import { getEmbedding, generateText } from "./ollama";

const OLLAMA_MODEL_LLM = process.env.OLLAMA_MODEL_LLM ?? "llama3:8b";
const OLLAMA_MODEL_EMBEDDING = process.env.OLLAMA_MODEL_EMBEDDING ?? "nomic-embed-text";

// ------------------------------------------------------------------
// Review job processor
// ------------------------------------------------------------------

async function processReviewJob(
  job: Job<ReviewPolicyJobData>,
): Promise<PolicyFinding[]> {
  const { policyContent, organizationId } = job.data;
  console.log(`[policy-review] ▶ Job ${job.id} — org=${organizationId}`);

  // 1. Embed the policy content for RAG lookup
  let queryEmbedding: number[];
  try {
    queryEmbedding = await getEmbedding(policyContent.slice(0, 512), OLLAMA_MODEL_EMBEDDING);
  } catch (err) {
    console.warn("[policy-review] Embedding failed — falling back to keyword search:", err);
    queryEmbedding = [];
  }

  // 2. Retrieve top regulation snippets (vector or fallback)
  let snippets: Array<{ sectionNumber: string; content: string }> = [];
  if (queryEmbedding.length > 0) {
    snippets = await prisma.$queryRawUnsafe<Array<{ sectionNumber: string; content: string }>>(
      `SELECT "sectionNumber", content
       FROM "RegulationSnippet"
       WHERE embedding IS NOT NULL
       ORDER BY (embedding <=> $1::vector) ASC
       LIMIT 8`,
      `[${queryEmbedding.join(",")}]`,
    );
  } else {
    snippets = await prisma.regulationSnippet.findMany({
      take: 8,
      select: { sectionNumber: true, content: true },
    });
  }

  // 3. Build the review prompt — LLM role is auditor, NOT author
  const snippetsText = snippets
    .map((s) => `[Section ${s.sectionNumber}]\n${s.content}`)
    .join("\n\n");

  const systemPrompt = `You are a compliance auditor reviewing a draft policy document against Indian data protection regulations. 
Your ONLY job is to identify gaps, conflicts, or issues. 
You do NOT rewrite, regenerate, or improve the policy text.
Return a JSON array of findings. Each finding must have:
  - type: one of "UNFILLED_VARIABLE" | "CLAUSE_CONFLICT" | "MISSING_REQUIREMENT"
  - description: concise explanation (max 200 chars)
  - regulationRef: section number from the regulation (if applicable, else null)
  - severity: "HIGH" | "MEDIUM" | "LOW"
Return ONLY valid JSON — no explanation, no markdown fences.`;

  const userPrompt = `Regulation excerpts:
${snippetsText}

Draft policy to review:
${policyContent.slice(0, 3000)}

Return JSON array of findings. If no issues found, return [].`;

  // 4. Run LLM — parse JSON, fall back to empty array on failure
  let findings: PolicyFinding[] = [];
  try {
    const rawOutput = await generateText(`${systemPrompt}\n\n${userPrompt}`, OLLAMA_MODEL_LLM);
    // Extract JSON array from response (LLM sometimes wraps it)
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      findings = parsed.filter(
        (f): f is PolicyFinding =>
          typeof f === "object" &&
          f !== null &&
          "type" in f &&
          "description" in f &&
          "severity" in f,
      );
    }
  } catch (err) {
    console.warn("[policy-review] LLM review failed — returning empty findings:", err);
  }

  console.log(`[policy-review] ✅ Job ${job.id} — ${findings.length} finding(s)`);
  return findings;
}

// ------------------------------------------------------------------
// Legacy job processor (migration shim)
// ------------------------------------------------------------------

async function processLegacyGenerationJob(
  job: Job<ProcessPolicyJobData>,
): Promise<string> {
  console.warn(
    `[policy-worker] ⚠️  Legacy generate-policy job ${job.id} detected. ` +
      "Phase 2 has removed AI-from-scratch policy generation. " +
      "Use the Template Builder at /dashboard/policies/new instead.",
  );
  return (
    `# Policy Generation Migrated\n\n` +
    `This job was submitted to the **generate-policy** queue which has been replaced in Phase 2.\n\n` +
    `Please use the new **Template-First Policy Builder** at \`/dashboard/policies/new\` to:\n` +
    `1. Choose a compliant template (Privacy Policy, Data Retention, Access Control, etc.)\n` +
    `2. Fill in your organisation's specific details\n` +
    `3. Request an AI audit of the rendered draft\n\n` +
    `The AI will review (not rewrite) your policy against DPDP Act 2023 requirements.`
  );
}

// ------------------------------------------------------------------
// Worker factories
// ------------------------------------------------------------------

export function startPolicyWorker() {
  // Review worker (Phase 2)
  const reviewWorker = new Worker<ReviewPolicyJobData, PolicyFinding[]>(
    REVIEW_QUEUE_NAME,
    processReviewJob,
    { connection: redisConnection(), concurrency: 2 },
  );

  // Legacy generation worker (drain old queue)
  const legacyWorker = new Worker<ProcessPolicyJobData, string>(
    POLICY_QUEUE_NAME,
    processLegacyGenerationJob,
    { connection: redisConnection(), concurrency: 1 },
  );

  for (const worker of [reviewWorker, legacyWorker]) {
    worker.on("completed", (job) => {
      console.log(`[policy-worker] ✅ Job ${job.id} completed`);
    });
    worker.on("failed", (job, err) => {
      console.error(`[policy-worker] ❌ Job ${job?.id} failed:`, err.message);
    });
    worker.on("error", (err) => {
      console.error("[policy-worker] Worker error:", err);
    });
  }

  console.log(`[policy-worker] Workers started — "${REVIEW_QUEUE_NAME}" + "${POLICY_QUEUE_NAME}" (legacy drain)`);

  // Return a combined "close" that drains both workers.
  //
  // `workers` is also exposed so callers can reach the underlying BullMQ
  // instances. Without it this function's return value was the one entry in
  // src/workers/index.ts with no `on()` method, so both of these queues were
  // silently excluded from dead-letter alerting — a permanently failed policy
  // review or legacy drain job would have gone unnoticed.
  return {
    workers: [reviewWorker, legacyWorker],
    close: async () => {
      await Promise.all([reviewWorker.close(), legacyWorker.close()]);
    },
  };
}

if (require.main === module) {
  const worker = startPolicyWorker();
  process.on("SIGTERM", async () => {
    console.log("[policy-worker] SIGTERM — draining…");
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
