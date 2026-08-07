/**
 * WAVE 7.1 — the policy lifecycle.
 *
 * Closes fullstack-audit-2026-08-06 §4 CRITICAL: policy.ts exposed only list,
 * create, listTemplates, generateFromTemplate, reviewDraft and getReviewStatus.
 * There was no getById, update, publish or delete, and `isPublished` was
 * settable only at create time — so a generated policy could never be opened,
 * edited, reviewed, published or removed. User_Journeys.md flow 3 ("TipTap
 * review/edit → publish → AuditLog entry") broke at the review step.
 *
 * Every procedure asserted here did not exist before this wave, so the whole
 * suite fails to compile against the pre-fix router — which is the proof.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role, PolicyType } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { policyRouter } from "@/server/routers/policy";
import { closeSessionIdentityRedis } from "@/server/lib/sessionIdentity";
import { seedRoleUser } from "./fixtures/seedRoleUser";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ policy: policyRouter });

function callerFor(user: { id: string; organizationId: string; role: Role }) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: user.id,
        email: "policy@test.dharma",
        name: "Policy Test",
        organizationId: user.organizationId,
        role: user.role,
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

let orgA: string;
let orgB: string;
let managerA: { id: string; organizationId: string; role: Role };
let viewerA: { id: string; organizationId: string; role: Role };
let managerB: { id: string; organizationId: string; role: Role };

async function seedPolicy(organizationId: string, overrides: Record<string, unknown> = {}) {
  return prisma.policy.create({
    data: {
      organizationId,
      title: `Policy ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: "The original body of the policy, long enough to pass validation.",
      policyType: PolicyType.ACCESS_CONTROL,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `policy-a-${Date.now()}` } })).id;
  orgB = (await prisma.organization.create({ data: { name: `policy-b-${Date.now()}` } })).id;
  managerA = await seedRoleUser(prisma, orgA, Role.COMPLIANCE_MANAGER, "policy");
  viewerA = await seedRoleUser(prisma, orgA, Role.VIEWER, "policy");
  managerB = await seedRoleUser(prisma, orgB, Role.COMPLIANCE_MANAGER, "policy");
});

afterAll(async () => {
  await prisma.policy.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.$disconnect();
  await closeSessionIdentityRedis();
});

describe("getById", () => {
  it("returns a policy in the caller's org", async () => {
    const policy = await seedPolicy(orgA);
    const found = await callerFor(managerA).policy.getById({ id: policy.id });
    expect(found.id).toBe(policy.id);
  });

  it("refuses another tenant's policy with NOT_FOUND, not FORBIDDEN", async () => {
    // Same response for "not yours" and "does not exist", so the endpoint
    // cannot be used to probe which policy ids exist elsewhere.
    const policy = await seedPolicy(orgA);
    await expect(
      callerFor(managerB).policy.getById({ id: policy.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is readable by a VIEWER — reviewing a policy is not a write", async () => {
    const policy = await seedPolicy(orgA);
    await expect(callerFor(viewerA).policy.getById({ id: policy.id })).resolves.toMatchObject({
      id: policy.id,
    });
  });
});

describe("update", () => {
  it("edits a draft without touching its version", async () => {
    const policy = await seedPolicy(orgA);
    const updated = await callerFor(managerA).policy.update({
      id: policy.id,
      content: "A revised body, still comfortably over the minimum length.",
    });

    expect(updated.content).toContain("A revised body");
    expect(updated.version).toBe(policy.version);
  });

  it("returns a PUBLISHED policy to draft and bumps the version when its text changes", async () => {
    // The compliance-correct behaviour: silently changing the text under a
    // "Published" badge would make the badge a lie.
    const policy = await seedPolicy(orgA, { isPublished: true, publishedAt: new Date() });

    const updated = await callerFor(managerA).policy.update({
      id: policy.id,
      content: "Materially different text that nobody has attested to yet.",
    });

    expect(updated.isPublished).toBe(false);
    expect(updated.publishedAt).toBeNull();
    expect(updated.version).toBe(policy.version + 1);
  });

  it("does NOT unpublish when only the title changes", async () => {
    // Retitling is not a change to the text anyone attested to.
    const policy = await seedPolicy(orgA, { isPublished: true, publishedAt: new Date() });

    const updated = await callerFor(managerA).policy.update({
      id: policy.id,
      title: "A clearer name for the same document",
    });

    expect(updated.isPublished).toBe(true);
    expect(updated.version).toBe(policy.version);
  });

  it("rejects an empty update", async () => {
    const policy = await seedPolicy(orgA);
    await expect(callerFor(managerA).policy.update({ id: policy.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses a VIEWER", async () => {
    const policy = await seedPolicy(orgA);
    await expect(
      callerFor(viewerA).policy.update({ id: policy.id, title: "Nice try" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a cross-tenant edit", async () => {
    const policy = await seedPolicy(orgA);
    await expect(
      callerFor(managerB).policy.update({ id: policy.id, title: "Not yours" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes an audit entry naming the changed fields", async () => {
    const policy = await seedPolicy(orgA);
    await callerFor(managerA).policy.update({
      id: policy.id,
      content: "Edited content that is long enough to satisfy the schema.",
    });

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: policy.id, action: "POLICY_UPDATED" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.changes).toMatchObject({ fields: ["content"] });
  });
});

describe("publish", () => {
  it("publishes a draft and stamps publishedAt", async () => {
    const policy = await seedPolicy(orgA);
    expect(policy.isPublished).toBe(false);

    const published = await callerFor(managerA).policy.publish({ id: policy.id });

    expect(published.isPublished).toBe(true);
    expect(published.publishedAt).toBeInstanceOf(Date);
  });

  it("writes the POLICY_PUBLISH audit entry User_Journeys flow 3 requires", async () => {
    const policy = await seedPolicy(orgA);
    await callerFor(managerA).policy.publish({ id: policy.id });

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: policy.id, action: "POLICY_PUBLISH" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.changes).toMatchObject({ version: policy.version });
  });

  it("refuses to publish twice", async () => {
    const policy = await seedPolicy(orgA);
    await callerFor(managerA).policy.publish({ id: policy.id });
    await expect(callerFor(managerA).policy.publish({ id: policy.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses a VIEWER", async () => {
    const policy = await seedPolicy(orgA);
    await expect(callerFor(viewerA).policy.publish({ id: policy.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("unpublish", () => {
  it("withdraws a published policy back to draft", async () => {
    // Publication must not be a one-way door — otherwise a policy published in
    // error can only be removed by deleting it.
    const policy = await seedPolicy(orgA, { isPublished: true, publishedAt: new Date() });

    const withdrawn = await callerFor(managerA).policy.unpublish({ id: policy.id });

    expect(withdrawn.isPublished).toBe(false);
    expect(withdrawn.publishedAt).toBeNull();
  });

  it("refuses to unpublish a draft", async () => {
    const policy = await seedPolicy(orgA);
    await expect(callerFor(managerA).policy.unpublish({ id: policy.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("delete", () => {
  it("soft-deletes: the row survives for the audit trail", async () => {
    const policy = await seedPolicy(orgA);
    await callerFor(managerA).policy.delete({ id: policy.id });

    const row = await prisma.policy.findUnique({ where: { id: policy.id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("removes it from list and from getById", async () => {
    const policy = await seedPolicy(orgA);
    await callerFor(managerA).policy.delete({ id: policy.id });

    const listed = await callerFor(managerA).policy.list();
    expect(listed.find((p) => p.id === policy.id)).toBeUndefined();

    await expect(callerFor(managerA).policy.getById({ id: policy.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("records whether the policy was live when it was removed", async () => {
    const policy = await seedPolicy(orgA, { isPublished: true, publishedAt: new Date() });
    await callerFor(managerA).policy.delete({ id: policy.id });

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: policy.id, action: "POLICY_DELETED" },
    });
    expect(entry?.changes).toMatchObject({ wasPublished: true, title: policy.title });
  });

  it("refuses a VIEWER and a cross-tenant caller", async () => {
    const policy = await seedPolicy(orgA);
    await expect(callerFor(viewerA).policy.delete({ id: policy.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(callerFor(managerB).policy.delete({ id: policy.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("cannot be deleted twice", async () => {
    const policy = await seedPolicy(orgA);
    await callerFor(managerA).policy.delete({ id: policy.id });
    await expect(callerFor(managerA).policy.delete({ id: policy.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("the full User_Journeys flow 3 round-trip", () => {
  it("create → open → edit → publish → audit entry exists", async () => {
    const caller = callerFor(managerA);

    const created = await caller.policy.create({
      title: "Access Control Policy",
      content: "The initial generated draft, long enough to satisfy validation.",
      policyType: PolicyType.ACCESS_CONTROL,
    });

    // Open it again — the step that was impossible before this wave.
    const opened = await caller.policy.getById({ id: created.id });
    expect(opened.title).toBe("Access Control Policy");

    await caller.policy.update({
      id: created.id,
      content: "The reviewed and edited draft, ready for approval.",
    });

    const published = await caller.policy.publish({ id: created.id });
    expect(published.isPublished).toBe(true);

    const actions = (
      await prisma.auditLog.findMany({
        where: { entityId: created.id },
        select: { action: true },
      })
    ).map((a) => a.action);

    expect(actions).toContain("POLICY_CREATED");
    expect(actions).toContain("POLICY_UPDATED");
    expect(actions).toContain("POLICY_PUBLISH");
  });
});
