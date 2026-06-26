import { Worker, Queue, type Job } from "bullmq";
import { PrismaClient, PolicyType } from "@prisma/client";
import { env } from "@/env";

declare global {
  // eslint-disable-next-line no-var
  var __workerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__workerPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__workerPrisma = prisma;
}

export const POLICY_QUEUE_NAME = "generate-policy";

export interface ProcessPolicyJobData {
  policyType: PolicyType;
  context: string;
}

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

export const policyQueue = new Queue<ProcessPolicyJobData>(POLICY_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

import { getEmbedding, generateText } from "./ollama";

const OLLAMA_MODEL_LLM = process.env.OLLAMA_MODEL_LLM || "llama3:8b";
const OLLAMA_MODEL_EMBEDDING = process.env.OLLAMA_MODEL_EMBEDDING || "nomic-embed-text";

async function generateEmbedding(text: string): Promise<number[]> {
  return getEmbedding(text, OLLAMA_MODEL_EMBEDDING);
}

async function generatePolicyWithOllama(prompt: string): Promise<string> {
  try {
    return await generateText(prompt, OLLAMA_MODEL_LLM);
  } catch (err) {
    console.warn(`Ollama generation failed: ${err instanceof Error ? err.message : String(err)}. Returning mock policy.`);
    return `# Mock Policy\n\nCould not reach Ollama (${OLLAMA_MODEL_LLM}).\n\n### Error Details:\n${err instanceof Error ? err.message : String(err)}\n\n### Required Context:\n${prompt.slice(0, 300)}...`;
  }
}

async function processPolicyJob(job: Job<ProcessPolicyJobData>): Promise<string> {
  const { policyType, context } = job.data;
  console.log(`[policy-worker] ▶ Starting job ${job.id} — type=${policyType}`);

  // 1. Embed the search context
  const searchQuery = `Policy Type: ${policyType}. Context: ${context}`;
  const queryEmbedding = await generateEmbedding(searchQuery);

  // 2. Perform Vector Search to get top 5 relevant DPDP Snippets
  // The embedding column is Unsupported("vector(384)")
  const snippets = await prisma.$queryRawUnsafe<{ id: string; sectionNumber: string; content: string; distance: number }[]>(
    `SELECT id, "sectionNumber", content,
            (embedding <=> $1::vector) as distance
     FROM "RegulationSnippet"
     WHERE embedding IS NOT NULL
     ORDER BY distance ASC
     LIMIT 5`,
    `[${queryEmbedding.join(",")}]`
  );

  console.log(`[policy-worker] Found ${snippets.length} relevant snippets.`);

  // 3. Construct prompt
  const snippetsText = snippets.map(s => `[Section ${s.sectionNumber}]\n${s.content}`).join("\n\n");
  
  const prompt = `You are a compliance expert. Using the following excerpts from the DPDP Act 2023:
${snippetsText}

Draft a comprehensive ${policyType} policy for an Indian MSME. 
The organization's context: ${context}. 
Output in markdown format with clear sections. DO NOT include any conversational text before or after the markdown.`;

  // 4. Generate policy text
  const policyMarkdown = await generatePolicyWithOllama(prompt);

  console.log(`[policy-worker] ✅ Completed job ${job.id} — Generated ${policyMarkdown.length} characters.`);
  
  // Return the generated markdown (will be stored in job.returnvalue)
  return policyMarkdown;
}

export function startPolicyWorker() {
  const worker = new Worker<ProcessPolicyJobData, string>(
    POLICY_QUEUE_NAME,
    processPolicyJob,
    {
      connection: redisConnection(),
      concurrency: 2,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[policy-worker] ✅ Job ${job.id} completed successfully.`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[policy-worker] ❌ Job ${job?.id} failed:`, err);
  });

  worker.on("error", (err) => {
    console.error("[policy-worker] Worker error:", err);
  });

  console.log(`[policy-worker] Worker started — queue="${POLICY_QUEUE_NAME}"`);

  return worker;
}

if (require.main === module) {
  const worker = startPolicyWorker();
  process.on("SIGTERM", async () => {
    console.log("[policy-worker] SIGTERM received — draining worker…");
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
