import http from "http";
import { env } from "@/env";

const OLLAMA_BASE_URL = env.OLLAMA_BASE_URL ?? "http://localhost:11434";

/**
 * Standard HTTP POST request using Node's native http module to avoid Undici fetch timeout.
 */
export function ollamaPost(path: string, body: any, timeoutMs = 600000): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlString = `${OLLAMA_BASE_URL.replace(/\/$/, "")}${path}`;
    const parsedUrl = new URL(urlString);
    const postData = JSON.stringify(body);

    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: timeoutMs, // Socket timeout
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON response from Ollama: ${e instanceof Error ? e.message : String(e)}`));
          }
        } else {
          reject(new Error(`Ollama request failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Ollama request to ${path} timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Generate 384-dimensional embedding using Ollama nomic-embed-text.
 */
export async function getEmbedding(text: string, model: string): Promise<number[]> {
  const prompt = text.trim() || "empty query";
  try {
    const json = await ollamaPost("/api/embeddings", { model, prompt });
    const embedding = json.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      console.warn("Ollama returned an empty or invalid embedding array. Using fallback zero-vector.");
      return new Array(384).fill(0.01);
    }
    return embedding.slice(0, 384);
  } catch (err) {
    console.warn(`Ollama embedding failed: ${err instanceof Error ? err.message : String(err)}. Using fallback zero-vector.`);
    return new Array(384).fill(0.01);
  }
}

/**
 * Generate text using Ollama LLM.
 */
export async function generateText(prompt: string, model: string): Promise<string> {
  const json = await ollamaPost("/api/generate", {
    model,
    prompt,
    stream: false,
  });
  return (json.response ?? "").trim();
}
