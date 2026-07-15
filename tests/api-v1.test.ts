// Phase 9 Part 3 — public API: key hash verify/reject, scope enforcement,
// full key lifecycle, and the mandatory CROSS-ORG security test (a valid key
// for org A against org B's resource id must 404, never 403 — no existence
// oracle). Routes are invoked directly (like the Part 1 heartbeat tests);
// AUDIT_WRITER_MODE=sync makes the fire-and-forget audit inline-safe.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { NextRequest } from "next/server";
import { PrismaClient, Role } from "@prisma/client";
import { generateApiKey, hashApiKey, verifyApiKey, keyHasScope, ApiKeyError } from "@/server/lib/apiKey";
import * as ControlsList from "@/app/api/v1/controls/route";
import * as ControlById from "@/app/api/v1/controls/[id]/route";
import * as EvidenceRoute from "@/app/api/v1/evidence/route";
import * as VulnRoute from "@/app/api/v1/vulnerabilities/route";

const prisma = new PrismaClient();

type OrgFix = { orgId: string; userId: string; controlId: string; token: string };

async function seedOrgWithKey(label: string, scopes: string[]): Promise<OrgFix> {
  const org = await prisma.organization.create({
    data: { name: `${label} ${Date.now()}-${Math.random()}` },
  });
  const user = await prisma.user.create({
    data: { email: `${label}-${Date.now()}@t.test`, organizationId: org.id, role: Role.ADMIN },
  });
  const framework = await prisma.framework.create({
    data: { organizationId: org.id, name: `FW ${label}` },
  });
  const control = await prisma.control.create({
    data: { frameworkId: framework.id, domain: "D", title: "Encryption", description: "x", status: "COMPLIANT" },
  });
  const { token, keyPrefix } = generateApiKey();
  await prisma.apiKey.create({
    data: {
      organizationId: org.id,
      name: `${label} key`,
      keyHash: hashApiKey(token),
      keyPrefix,
      scopes,
      createdById: user.id,
    },
  });
  return { orgId: org.id, userId: user.id, controlId: control.id, token };
}

function req(path: string, token: string | null, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost:3000/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

let orgA: OrgFix; // full scopes
let orgB: OrgFix; // full scopes (the "other" tenant)
let readOnly: OrgFix; // controls:read only

beforeAll(async () => {
  orgA = await seedOrgWithKey("ApiA", ["controls:read", "evidence:read", "evidence:write", "vulnerabilities:read"]);
  orgB = await seedOrgWithKey("ApiB", ["controls:read", "evidence:read", "evidence:write"]);
  readOnly = await seedOrgWithKey("ApiRO", ["controls:read"]);
});

afterAll(async () => {
  for (const f of [orgA, orgB, readOnly]) {
    await prisma.organization.delete({ where: { id: f.orgId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe("API key hashing & verification", () => {
  it("generates a prefixed key and stores only its hash", () => {
    const { token, keyPrefix } = generateApiKey();
    expect(token).toMatch(/^dhm_[0-9a-f]{48}$/);
    expect(keyPrefix.startsWith("dhm_")).toBe(true);
    expect(hashApiKey(token)).toHaveLength(64);
    expect(hashApiKey(token)).not.toContain(token);
  });

  it("verifies a valid key and rejects malformed / unknown / revoked", async () => {
    const ok = await verifyApiKey(prisma, orgA.token);
    expect(ok.organizationId).toBe(orgA.orgId);

    await expect(verifyApiKey(prisma, "garbage")).rejects.toMatchObject({ reason: "MALFORMED" });
    await expect(verifyApiKey(prisma, generateApiKey().token)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(verifyApiKey(prisma, undefined)).rejects.toBeInstanceOf(ApiKeyError);
  });

  it("keyHasScope respects the stored scope list", () => {
    expect(keyHasScope({ scopes: ["controls:read"] }, "controls:read")).toBe(true);
    expect(keyHasScope({ scopes: ["controls:read"] }, "evidence:write")).toBe(false);
  });
});

describe("authentication & scope enforcement on routes", () => {
  it("401 without a bearer token", async () => {
    const res = await ControlsList.GET(req("/controls", null));
    expect(res.status).toBe(401);
  });

  it("401 for an unknown key", async () => {
    const res = await ControlsList.GET(req("/controls", generateApiKey().token));
    expect(res.status).toBe(401);
  });

  it("200 + org-scoped data for a valid controls:read key", async () => {
    const res = await ControlsList.GET(req("/controls", orgA.token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.every((c: { id: string }) => c.id === orgA.controlId)).toBe(true);
  });

  it("403 when the key lacks the required scope (controls:read key → POST /evidence)", async () => {
    const res = await EvidenceRoute.POST(
      req("/evidence", readOnly.token, {
        method: "POST",
        body: { controlId: readOnly.controlId, fileName: "e.pdf", type: "API_RESPONSE" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("403 on a scope the key doesn't hold (readOnly → GET /vulnerabilities)", async () => {
    const res = await VulnRoute.GET(req("/vulnerabilities", readOnly.token));
    expect(res.status).toBe(403);
  });
});

describe("POST /evidence write path", () => {
  it("creates evidence with source \"api\" for an in-org control", async () => {
    const res = await EvidenceRoute.POST(
      req("/evidence", orgA.token, {
        method: "POST",
        body: { controlId: orgA.controlId, fileName: "pushed.json", type: "API_RESPONSE", summary: "via api" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.source).toBe("api");

    const stored = await prisma.evidence.findUnique({ where: { id: body.data.id } });
    expect(stored?.organizationId).toBe(orgA.orgId);
    expect(stored?.source).toBe("api");
  });
});

describe("CROSS-ORG SECURITY TEST (mandatory)", () => {
  it("a valid org-A key cannot read org-B's control by id → 404, NOT 403", async () => {
    const res = await ControlById.GET(req(`/controls/${orgB.controlId}`, orgA.token), {
      params: { id: orgB.controlId },
    });
    // 404 (not 403/200) — we neither serve it nor confirm it exists elsewhere.
    expect(res.status).toBe(404);
  });

  it("a valid org-A key cannot push evidence onto org-B's control → 404, no cross-tenant write", async () => {
    const before = await prisma.evidence.count({ where: { controlId: orgB.controlId } });
    const res = await EvidenceRoute.POST(
      req("/evidence", orgA.token, {
        method: "POST",
        body: { controlId: orgB.controlId, fileName: "attack.json", type: "API_RESPONSE" },
      }),
    );
    expect(res.status).toBe(404);
    const after = await prisma.evidence.count({ where: { controlId: orgB.controlId } });
    expect(after).toBe(before); // nothing written to org B
  });
});

describe("API key lifecycle: create → use → revoke → 401", () => {
  it("a revoked key is rejected on the next request", async () => {
    const fix = await seedOrgWithKey("ApiLifecycle", ["controls:read"]);
    // Use it — works.
    const ok = await ControlsList.GET(req("/controls", fix.token));
    expect(ok.status).toBe(200);

    // Revoke it directly (mirrors apiKey.revoke).
    await prisma.apiKey.updateMany({
      where: { organizationId: fix.orgId },
      data: { revokedAt: new Date() },
    });

    const after = await ControlsList.GET(req("/controls", fix.token));
    expect(after.status).toBe(401);

    await prisma.organization.delete({ where: { id: fix.orgId } }).catch(() => undefined);
  });
});
