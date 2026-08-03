/**
 * Advisor readiness probe: covers the three ways the assistant can be unusable
 * while `health.checkAll` still reports Ollama as "up", and asserts the probe
 * never leaks infrastructure detail into user-facing copy.
 */

import { checkAdvisorHealth } from "@/server/ai/advisorHealth";

const originalFetch = global.fetch;
const originalModel = process.env.OLLAMA_MODEL_EMBEDDING;

function mockTags(models: string[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ models: models.map((name) => ({ name })) }),
  }) as unknown as typeof fetch;
}

describe("checkAdvisorHealth", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalModel === undefined) delete process.env.OLLAMA_MODEL_EMBEDDING;
    else process.env.OLLAMA_MODEL_EMBEDDING = originalModel;
    jest.restoreAllMocks();
  });

  it("is healthy when the configured model is pulled", async () => {
    process.env.OLLAMA_MODEL_EMBEDDING = "all-minilm";
    mockTags(["all-minilm:latest", "llama3:8b"]);
    const health = await checkAdvisorHealth("http://ollama:11434");
    expect(health.healthy).toBe(true);
    expect(health.reason).toBeUndefined();
  });

  it("reports MODEL_MISSING when Ollama is up but the model was never pulled", async () => {
    process.env.OLLAMA_MODEL_EMBEDDING = "all-minilm";
    mockTags(["llama3:8b"]);
    const health = await checkAdvisorHealth();
    expect(health.healthy).toBe(false);
    expect(health.reason).toBe("MODEL_MISSING");
  });

  it("reports DIMENSION_MISMATCH for a model the schema cannot store", async () => {
    process.env.OLLAMA_MODEL_EMBEDDING = "nomic-embed-text";
    mockTags(["nomic-embed-text:latest"]);
    const health = await checkAdvisorHealth();
    expect(health.healthy).toBe(false);
    expect(health.reason).toBe("DIMENSION_MISMATCH");
    expect(health.compatibility.knownDimension).toBe(768);
  });

  it("reports UNREACHABLE instead of throwing when Ollama is down", async () => {
    process.env.OLLAMA_MODEL_EMBEDDING = "all-minilm";
    global.fetch = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434")) as unknown as typeof fetch;
    const health = await checkAdvisorHealth();
    expect(health.healthy).toBe(false);
    expect(health.reason).toBe("UNREACHABLE");
  });

  it("never leaks connection detail into the user-facing message", async () => {
    process.env.OLLAMA_MODEL_EMBEDDING = "all-minilm";
    global.fetch = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434")) as unknown as typeof fetch;
    const health = await checkAdvisorHealth();
    expect(health.message).toBeDefined();
    expect(health.message).not.toMatch(/ECONNREFUSED|11434|ollama/i);
  });
});
