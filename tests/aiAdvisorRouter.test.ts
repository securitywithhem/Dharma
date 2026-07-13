/**
 * tests/aiAdvisorRouter.test.ts — Phase 7 Part 2
 *
 * Runnable (no services): rate-limit + budget enforcement, guardrail fallback,
 * scope flagging, prompt composition / intent routing (via a fake Prisma and
 * injected retrieve/stream), and the router auth guard.
 *
 * DB-gated: end-to-end persistence (AIAdvisorSession + AIUsageLog) and
 * cross-org getSession/deleteSession rejection against a live Postgres.
 */
import { PrismaClient, Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";

// audit-log writes use a Serializable $transaction + advisory lock; stub it.
jest.mock("@/server/audit-log", () => ({ createAuditLog: jest.fn().mockResolvedValue(undefined) }));

// eslint-disable-next-line import/first
import { runAdvisorTurn } from "@/server/ai/advisorService";
// eslint-disable-next-line import/first
import { aiAdvisorRouter } from "@/server/routers/aiAdvisor";
// eslint-disable-next-line import/first
import {
  enforceAiRateLimit,
  enforceMonthlyBudget,
  AI_REQUESTS_PER_MINUTE,
  AI_BUDGET_EXCEEDED,
} from "@/server/ai/usageLimits";
// eslint-disable-next-line import/first
import { INSUFFICIENT_CONTEXT_ANSWER } from "@/server/ai/promptTemplates";
// eslint-disable-next-line import/first
import type { RetrievedContext as RC } from "@/server/ai/retrieval";

const uid = () => `id_${Math.random().toString(36).slice(2)}`;

const emptyContext = (): RC => ({ query: "q", chunks: [], graphRelations: [], liveControls: [] });
const contextWithChunk = (): RC => ({
  query: "q",
  chunks: [{ id: "k1", content: "MFA enforced for admins", chunkIndex: 0, documentType: "policy_doc", documentId: "d", sourceDocumentId: "d", graphNodeId: null, distance: 0.1 }],
  graphRelations: [],
  liveControls: [],
});

function makeServicePrisma(opts: { limits?: Record<string, unknown>; usedPrompt?: number; usedCompletion?: number } = {}) {
  const store = { sessions: new Map<string, any>(), usage: [] as any[] };
  const prisma = {
    organization: { findUnique: jest.fn(async () => ({ plan: { limits: opts.limits ?? {} } })) },
    aIUsageLog: {
      aggregate: jest.fn(async () => ({ _sum: { promptTokens: opts.usedPrompt ?? 0, completionTokens: opts.usedCompletion ?? 0 } })),
      create: jest.fn(async ({ data }: any) => {
        store.usage.push(data);
        return data;
      }),
    },
    aIAdvisorSession: {
      findFirst: jest.fn(async ({ where }: any) => store.sessions.get(where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const s = { id: `sess_${uid()}`, ...data };
        store.sessions.set(s.id, s);
        return s;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = store.sessions.get(where.id);
        Object.assign(s, data);
        return s;
      }),
    },
    __store: store,
  };
  return prisma;
}

describe("usageLimits — rate limiting & budget (runnable)", () => {
  it("enforceAiRateLimit throws TOO_MANY_REQUESTS past the per-minute cap", () => {
    const org = uid();
    for (let i = 0; i < AI_REQUESTS_PER_MINUTE; i++) enforceAiRateLimit(org); // allowed
    let err: unknown;
    try {
      enforceAiRateLimit(org);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });

  it("enforceMonthlyBudget throws AI_BUDGET_EXCEEDED when over budget, passes under", async () => {
    const over = makeServicePrisma({ limits: { aiTokensPerMonth: 1000 }, usedPrompt: 900, usedCompletion: 200 });
    await expect(enforceMonthlyBudget(over as any, "org1")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(enforceMonthlyBudget(over as any, "org1")).rejects.toThrow(new RegExp(AI_BUDGET_EXCEEDED));

    const under = makeServicePrisma({ limits: { aiTokensPerMonth: 50_000 }, usedPrompt: 10, usedCompletion: 10 });
    await expect(enforceMonthlyBudget(under as any, "org1")).resolves.toBeUndefined();
  });
});

describe("runAdvisorTurn — guardrails (runnable)", () => {
  it("forces the fixed fallback and skips the LLM when retrieval is insufficient", async () => {
    const prisma = makeServicePrisma();
    const stream = jest.fn();
    const res = await runAdvisorTurn(prisma as any, { organizationId: uid(), userId: "u1", message: "hi" }, {
      retrieve: async () => emptyContext(),
      stream: stream as any,
    });
    expect(res.message).toBe(INSUFFICIENT_CONTEXT_ANSWER);
    expect(res.insufficientContext).toBe(true);
    expect(stream).not.toHaveBeenCalled();
    // Turn is still persisted and usage (zero) recorded.
    expect(prisma.aIAdvisorSession.update).toHaveBeenCalled();
    expect(prisma.aIUsageLog.create).toHaveBeenCalled();
  });

  it("flags out-of-domain output but does not rewrite it", async () => {
    const prisma = makeServicePrisma();
    const res = await runAdvisorTurn(prisma as any, { organizationId: uid(), userId: "u1", message: "explain our access controls" }, {
      retrieve: async () => contextWithChunk(),
      stream: async () => ({ fullText: "Here:\n```python\nprint('x')\n```", usage: { promptTokens: 5, completionTokens: 5 } }),
    });
    expect(res.flagged).toBe(true);
    expect(res.message).toContain("```python"); // not rewritten
  });

  it("composes a prompt containing the <retrieved_chunks> block for Q&A", async () => {
    const prisma = makeServicePrisma();
    let capturedUser = "";
    let capturedSystem = "";
    await runAdvisorTurn(prisma as any, { organizationId: uid(), userId: "u1", message: "What is our MFA posture?" }, {
      retrieve: async () => contextWithChunk(),
      stream: async ({ systemPrompt, messages }) => {
        capturedSystem = systemPrompt;
        capturedUser = messages[messages.length - 1].content;
        return { fullText: "MFA is enforced [[chunk:k1]].", usage: { promptTokens: 10, completionTokens: 4 } };
      },
    });
    expect(capturedSystem).toMatch(/Compliance Advisor/);
    expect(capturedUser).toContain("<retrieved_chunks>");
    expect(capturedUser).toContain("MFA enforced for admins");
  });

  it("routes policy-draft intent to the policy builder prompt", async () => {
    const prisma = makeServicePrisma();
    let capturedUser = "";
    const res = await runAdvisorTurn(prisma as any, { organizationId: uid(), userId: "u1", message: "Draft a policy for access control" }, {
      retrieve: async () => contextWithChunk(),
      stream: async ({ messages }) => {
        capturedUser = messages[messages.length - 1].content;
        return { fullText: "Policy...", usage: { promptTokens: 10, completionTokens: 4 } };
      },
    });
    expect(res.intent).toBe("policy_draft");
    expect(capturedUser).toMatch(/Purpose/);
    expect(capturedUser).toContain("access control");
  });

  it("parses inline citations from the answer", async () => {
    const prisma = makeServicePrisma();
    const res = await runAdvisorTurn(prisma as any, { organizationId: uid(), userId: "u1", message: "status of CC6.1?" }, {
      retrieve: async () => contextWithChunk(),
      stream: async () => ({ fullText: "It is compliant [[control:c1]] per [[chunk:k1]].", usage: { promptTokens: 3, completionTokens: 3 } }),
    });
    expect(res.citations).toEqual(expect.arrayContaining([
      { type: "control", id: "c1" },
      { type: "chunk", id: "k1" },
    ]));
  });
});

// ---------------------------------------------------------------------------
// Router auth + org scoping
// ---------------------------------------------------------------------------

const testRouter = createTRPCRouter({ aiAdvisor: aiAdvisorRouter });
const prisma = new PrismaClient();
let dbReady = false;

function createCaller(orgId: string | null, userId: string, role: Role = Role.ADMIN) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: orgId
      ? { user: { id: userId, email: `${userId}@t.com`, name: "T", organizationId: orgId, role }, expires: new Date(Date.now() + 86_400_000).toISOString() }
      : null,
    isAuditor: false,
    auditorTokenExpiry: undefined,
  } as never);
}

describe("aiAdvisorRouter — auth & org scoping", () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      dbReady = true;
    } catch {
      console.warn("[aiAdvisorRouter.test] No database reachable — DB-gated tests skipped.");
    }
  });
  afterAll(async () => {
    await prisma.$disconnect().catch(() => {});
  });

  it("rejects unauthenticated calls (no services needed)", async () => {
    const caller = createCaller(null, "nobody");
    await expect(caller.aiAdvisor.listSessions({})).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.aiAdvisor.getSession({ sessionId: "x" })).rejects.toBeInstanceOf(TRPCError);
  });

  it("persists the turn and usage, and org-scopes session access (DB-gated)", async () => {
    if (!dbReady) return;
    const stamp = `${Date.now()}-${Math.random()}`;
    const orgA = await prisma.organization.create({ data: { name: `adv-A ${stamp}` } });
    const userA = await prisma.user.create({ data: { email: `a-${stamp}@t.com`, name: "A", role: Role.ADMIN, organizationId: orgA.id } });
    const orgB = await prisma.organization.create({ data: { name: `adv-B ${stamp}` } });
    const userB = await prisma.user.create({ data: { email: `b-${stamp}@t.com`, name: "B", role: Role.ADMIN, organizationId: orgB.id } });

    const turn = await runAdvisorTurn(
      prisma,
      { organizationId: orgA.id, userId: userA.id, message: "What is our MFA posture?" },
      { retrieve: async () => contextWithChunk(), stream: async () => ({ fullText: "MFA enforced [[chunk:k1]].", usage: { promptTokens: 12, completionTokens: 5 } }) },
    );

    const session = await prisma.aIAdvisorSession.findUnique({ where: { id: turn.sessionId } });
    expect(Array.isArray(session?.messages)).toBe(true);
    expect((session?.messages as any[]).length).toBe(2);
    const usage = await prisma.aIUsageLog.findFirst({ where: { sessionId: turn.sessionId } });
    expect(usage?.promptTokens).toBe(12);

    // Org B cannot read org A's session.
    const callerB = createCaller(orgB.id, userB.id);
    await expect(callerB.aiAdvisor.getSession({ sessionId: turn.sessionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.aiAdvisor.deleteSession({ sessionId: turn.sessionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
