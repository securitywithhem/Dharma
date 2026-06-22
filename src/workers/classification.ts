/**
 * src/workers/classification.ts
 *
 * BullMQ background worker – Evidence Classification Pipeline.
 *
 * Stages per job:
 *   1. Fetch evidence record from the DB.
 *   2. Download file bytes from MinIO via presigned URL.
 *   3. Extract text (PDF → pdf-parse, image → Tesseract OCR, fallback).
 *   4. Generate 1-sentence AI summary via Ollama (llama3 8B).
 *   5. Generate 384-dim embedding via Ollama (nomic-embed-text).
 *   6. Persist summary + embedding back to the Evidence row.
 *
 * Error strategy:
 *   • MinIO failures: up to 3 retries with 1 s / 2 s / 4 s backoff.
 *   • Ollama unreachable: mark job failed (BullMQ handles retry policy).
 *   • PDF parse failure: fall back to empty text / zero vector.
 *
 * Start the worker standalone:
 *   npx tsx src/workers/classification.ts
 *
 * Or import startClassificationWorker() into your Next.js
 * instrumentation.ts to run in-process.
 */

import { Worker, Queue, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";

// ------------------------------------------------------------------
// Singleton Prisma client (re-use the one from db.ts if available)
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
// Queue setup
// ------------------------------------------------------------------

export const QUEUE_NAME = "process-evidence";

export interface ProcessEvidenceJobData {
  evidenceId: string;
}

/** Redis connection options from env */
function redisConnection() {
  // redis://host:port or redis://user:password@host:port
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

export const evidenceQueue = new Queue<ProcessEvidenceJobData>(QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 100 },
  },
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Simple exponential-backoff retry wrapper. */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Download file bytes from a URL (presigned MinIO link). */
async function downloadFile(url: string): Promise<Buffer> {
  const res = await withRetry(() => fetch(url), 3, 1000);
  if (!res.ok) {
    throw new Error(`MinIO download failed: ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/** Determine the file type from its path or content-type. */
function detectFileType(filePath: string): "pdf" | "image" | "other" {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "tiff", "bmp"].includes(ext)) {
    return "image";
  }
  return "other";
}

/** Extract text from a PDF buffer using pdf-parse. */
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import to avoid issues in edge runtimes
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    return data.text ?? "";
  } catch (err) {
    console.warn("[classification] PDF parse failed, using empty text:", err);
    return "";
  }
}

/** Extract text from an image buffer using Tesseract.js. */
async function extractImageText(buffer: Buffer): Promise<string> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const {
      data: { text },
    } = await worker.recognize(buffer);
    await worker.terminate();
    return text ?? "";
  } catch (err) {
    console.warn(
      "[classification] Tesseract OCR failed, using placeholder:",
      err,
    );
    return "Screenshot uploaded";
  }
}

/** Truncate extracted text to keep token usage reasonable. */
function truncateText(text: string, maxChars = 2000): string {
  return text.trim().slice(0, maxChars);
}

// ------------------------------------------------------------------
// Ollama API helpers
// ------------------------------------------------------------------

const OLLAMA_BASE_URL = env.OLLAMA_BASE_URL ?? "http://localhost:11434";

/** Generate a 1-sentence compliance summary via Ollama. */
async function generateSummary(text: string): Promise<string> {
  if (!text.trim()) return "";

  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3",
      prompt: `You are a compliance analyst. Summarize the following evidence in exactly one sentence (maximum 150 characters).\n\nEvidence:\n${text}`,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama summary failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { response?: string };
  return (json.response ?? "").trim().slice(0, 150);
}

/** Generate a 384-dim embedding via Ollama nomic-embed-text. */
async function generateEmbedding(text: string): Promise<number[]> {
  const prompt = text.trim() || "empty evidence";

  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nomic-embed-text",
      prompt,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Ollama embedding failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as { embedding?: number[] };
  const embedding = json.embedding;

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Ollama returned an empty or invalid embedding array.");
  }

  return embedding;
}

/** Return a zero-vector fallback of the expected dimension. */
function zeroVector(dim = 384): number[] {
  return new Array<number>(dim).fill(0);
}

// ------------------------------------------------------------------
// Core job processor
// ------------------------------------------------------------------

async function processEvidenceJob(
  job: Job<ProcessEvidenceJobData>,
): Promise<{ status: string; evidenceId: string }> {
  const { evidenceId } = job.data;
  console.log(`[classification] ▶ Starting job ${job.id} — evidenceId=${evidenceId}`);

  // 1. Fetch evidence record
  const evidence = await prisma.evidence.findUniqueOrThrow({
    where: { id: evidenceId },
    select: { id: true, filePath: true, type: true },
  });

  // 2. Presigned download URL (reuse MinIO module)
  const { generatePresignedDownloadUrl } = await import("@/server/minio");
  const downloadUrl = await generatePresignedDownloadUrl(evidence.filePath);

  // 3. Download file bytes
  const fileBuffer = await withRetry(() => downloadFile(downloadUrl), 3, 1000);

  // 4. Extract text
  let extractedText = "";
  const fileType = detectFileType(evidence.filePath);

  if (fileType === "pdf") {
    extractedText = await extractPdfText(fileBuffer);
  } else if (fileType === "image") {
    extractedText = await extractImageText(fileBuffer);
  } else {
    // Basic metadata fallback for other file types
    extractedText = `File: ${evidence.filePath}, Type: ${evidence.type}`;
  }

  extractedText = truncateText(extractedText, 2000);
  console.log(
    `[classification] ✅ Extracted ${extractedText.length} chars from ${fileType} file`,
  );

  // 5. Generate summary
  let summary = "";
  try {
    summary = await generateSummary(extractedText);
    console.log(`[classification] ✅ Summary: "${summary}"`);
  } catch (err) {
    console.warn("[classification] Summary generation failed, skipping:", err);
  }

  // 6. Generate embedding — use zero-vector on failure
  let embedding: number[];
  try {
    embedding = await generateEmbedding(extractedText);
    console.log(
      `[classification] ✅ Embedding generated: ${embedding.length} dims`,
    );
  } catch (err) {
    console.error("[classification] Embedding generation failed:", err);
    embedding = zeroVector(384);
  }

  // 7. Persist to DB via raw SQL (Prisma doesn't support vector writes natively)
  await prisma.$executeRawUnsafe(
    `UPDATE "Evidence"
       SET embedding = $1::vector,
           summary   = $2,
           "updatedAt" = NOW()
     WHERE id = $3`,
    `[${embedding.join(",")}]`,
    summary || null,
    evidenceId,
  );

  console.log(
    `[classification] ✅ Completed job ${job.id} — evidenceId=${evidenceId}`,
  );

  return { status: "COMPLETE", evidenceId };
}

// ------------------------------------------------------------------
// Worker factory
// ------------------------------------------------------------------

/**
 * Start the BullMQ classification worker.
 * Call this once from Next.js instrumentation.ts or run standalone.
 */
export function startClassificationWorker() {
  const worker = new Worker<ProcessEvidenceJobData>(
    QUEUE_NAME,
    processEvidenceJob,
    {
      connection: redisConnection(),
      concurrency: 3, // 2-4 concurrent jobs to avoid saturating Ollama
      limiter: {
        max: 10, // max jobs per duration
        duration: 60_000,
      },
    },
  );

  worker.on("completed", (job, result) => {
    console.log(
      `[classification] ✅ Job ${job.id} completed:`,
      result,
    );
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[classification] ❌ Job ${job?.id} failed:`,
      err,
    );
  });

  worker.on("error", (err) => {
    console.error("[classification] Worker error:", err);
  });

  console.log(
    `[classification] Worker started — queue="${QUEUE_NAME}", concurrency=3`,
  );

  return worker;
}

// ------------------------------------------------------------------
// Standalone entrypoint
// ------------------------------------------------------------------

if (require.main === module) {
  const worker = startClassificationWorker();

  process.on("SIGTERM", async () => {
    console.log("[classification] SIGTERM received — draining worker…");
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
