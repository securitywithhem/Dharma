import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";

const prisma = new PrismaClient();
const OLLAMA_BASE_URL = env.OLLAMA_BASE_URL ?? "http://localhost:11434";

/** 
 * Generate a 384-dim embedding via Ollama nomic-embed-text 
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const prompt = text.trim() || "empty regulation snippet";

  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nomic-embed-text",
      prompt,
    }),
  });

  if (!res.ok) {
    console.warn(`Ollama embedding failed: ${res.status} ${res.statusText}. Using fallback zero-vector.`);
    return new Array(384).fill(0.01);
  }

  const json = (await res.json()) as { embedding?: number[] };
  const embedding = json.embedding;

  if (!Array.isArray(embedding) || embedding.length === 0) {
    console.warn("Ollama returned an empty or invalid embedding array. Using fallback zero-vector.");
    return new Array(384).fill(0.01);
  }

  return embedding.slice(0, 384);
}

/**
 * Split text into chunks of `maxLen` with `overlap`
 */
function chunkText(text: string, maxLen = 500, overlap = 100): string[] {
  const chunks: string[] = [];
  let index = 0;
  
  while (index < text.length) {
    let chunk = text.slice(index, index + maxLen);
    
    // Attempt to break at the last newline or space if not at the end
    if (index + maxLen < text.length) {
      let lastNewline = chunk.lastIndexOf("\n");
      let lastSpace = chunk.lastIndexOf(" ");
      
      let breakIndex = Math.max(lastNewline, lastSpace);
      if (breakIndex > maxLen / 2) {
        chunk = chunk.slice(0, breakIndex);
        index += breakIndex;
      } else {
        index += maxLen;
      }
    } else {
      index += maxLen;
    }

    chunks.push(chunk.trim());
    
    if (index < text.length) {
      index -= overlap;
    }
  }
  
  return chunks.filter(c => c.length > 0);
}

async function main() {
  console.log("🔍 Seeding Regulation Snippets...");

  const dataPath = path.join(__dirname, "../data/frameworks/dpdp-act-2023.json");
  
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Could not find DPDP Act JSON at ${dataPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(dataPath, "utf-8");
  const dpdpData = JSON.parse(rawData);
  
  const frameworkName = dpdpData.frameworkName || "DPDP Act 2023";

  // Check if we already have snippets for this framework
  const existingSnippets = await prisma.regulationSnippet.count({
    where: { frameworkName }
  });

  if (existingSnippets > 0) {
    console.log(`✅ Snippets for '${frameworkName}' already exist (${existingSnippets} records). Nothing to do.`);
    return;
  }

  let totalChunks = 0;

  for (const domain of dpdpData.domains) {
    for (const control of domain.controls) {
      const sectionText = `${control.title}\n\nDescription: ${control.description}\n\nGuidance: ${control.guidance}`;
      const chunks = chunkText(sectionText, 500, 100);

      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i];
        
        try {
          const embedding = await generateEmbedding(chunkContent);
          
          const snippet = await prisma.regulationSnippet.create({
            data: {
              frameworkName,
              sectionNumber: `${control.id} (Part ${i + 1})`,
              content: chunkContent
            }
          });

          // Update vector directly
          await prisma.$executeRawUnsafe(
            `UPDATE "RegulationSnippet"
               SET embedding = $1::vector
             WHERE id = $2`,
            `[${embedding.join(",")}]`,
            snippet.id
          );
          
          totalChunks++;
          console.log(`Added snippet: ${snippet.sectionNumber}`);
        } catch (error) {
          console.error(`Failed to process chunk for ${control.id}:`, error);
        }
      }
    }
  }

  console.log(`🎉 Seeding complete. Inserted ${totalChunks} regulation snippets.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
