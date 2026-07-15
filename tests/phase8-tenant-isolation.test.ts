// Phase 8 — consolidated tenant-isolation regression suite (Implementation
// Plan "Integration & Testing": "Full regression on tenant isolation after
// each phase"). Covers all three parts together: SSO config, SCIM tokens,
// custom roles, audit logs/chains, white-label domains, and MSSP grants.
// Deep per-feature isolation cases live in the feature suites; this file is
// the cross-phase sweep that must stay green as a unit.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { ssoRouter } from "@/server/routers/sso";
import { rolesRouter } from "@/server/routers/roles";
import { whiteLabelRouter } from "@/server/routers/whiteLabel";
import * as ScimUsersRoute from "@/app/api/scim/v2/[orgId]/Users/route";
import { getAuditEventChain } from "@/server/services/audit/graph.service";
import { emitAuditEvent } from "@/server/services/audit/writer";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({
  sso: ssoRouter,
  roles: rolesRouter,
  whiteLabel: whiteLabelRouter,
});

function callerFor(orgId: string, userId: string) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: userId, email: "i@i.test", name: "I", organizationId: orgId, role: Role.ADMIN },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

async function seedOrg(label: string) {
  const org = await prisma.organization.create({
    data: { name: `${label} ${Date.now()}-${Math.random()}` },
  });
  const admin = await prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@test.com`,
      organizationId: org.id,
      role: Role.ADMIN,
    },
  });
  return { org, admin };
}

let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;
const scimTokenA = `dscim_${randomBytes(16).toString("hex")}`;

beforeAll(async () => {
  a = await seedOrg("Iso8A");
  b = await seedOrg("Iso8B");
  await prisma.organizationSettings.create({
    data: {
      organizationId: a.org.id,
      scimEnabled: true,
      scimTokenHash: createHash("sha256").update(scimTokenA).digest("hex"),
      ssoConfig: {
        type: "SAML",
        entityId: "https://idp-a.test",
        ssoUrl: "https://idp-a.test/sso",
        certificate: "A".repeat(64),
      },
    },
  });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: a.org.id } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: b.org.id } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("Phase 8 tenant isolation regression", () => {
  it("SSO config isolation: org B sees no config and cannot read org A's", async () => {
    const bConfig = await callerFor(b.org.id, b.admin.id).sso.getConfig();
    expect(bConfig.ssoConfig).toBeNull();

    const aConfig = await callerFor(a.org.id, a.admin.id).sso.getConfig();
    expect(aConfig.ssoConfig).not.toBeNull();
    // The tRPC layer offers no input to address another org — the org always
    // comes from the session. This assertion pins that contract.
    expect(aConfig.urls.scimBase).toContain(a.org.id);
  });

  it("SCIM token isolation: org A's token cannot list or create users in org B", async () => {
    const list = await ScimUsersRoute.GET(
      new NextRequest(`http://localhost:3000/api/scim/v2/${b.org.id}/Users`, {
        headers: { authorization: `Bearer ${scimTokenA}` },
      }),
      { params: { orgId: b.org.id } },
    );
    expect(list.status).toBe(401);

    const create = await ScimUsersRoute.POST(
      new NextRequest(`http://localhost:3000/api/scim/v2/${b.org.id}/Users`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${scimTokenA}`,
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({ userName: `steal-${Date.now()}@x.test` }),
      }),
      { params: { orgId: b.org.id } },
    );
    expect(create.status).toBe(401);
  });

  it("custom role isolation: org A's roles are invisible to and unusable by org B", async () => {
    const roleA = await callerFor(a.org.id, a.admin.id).roles.create({
      name: `IsoRole-${Date.now()}`,
      permissions: { "controls.read": true },
    });

    const bRoles = await callerFor(b.org.id, b.admin.id).roles.list();
    expect(bRoles.map((r) => r.id)).not.toContain(roleA.id);

    await expect(
      callerFor(b.org.id, b.admin.id).roles.update({ id: roleA.id, name: "hijack" }),
    ).rejects.toThrow(/NOT_FOUND|not found/i);
  });

  it("audit isolation: org A's events never leak into org B's chains", async () => {
    const sharedEntityId = `shared-${Date.now()}`;
    await emitAuditEvent(prisma, {
      organizationId: a.org.id,
      userId: a.admin.id,
      action: "ISO_EVENT_A",
      entity: "Control",
      entityId: sharedEntityId,
      changes: null,
    });
    await emitAuditEvent(prisma, {
      organizationId: b.org.id,
      userId: b.admin.id,
      action: "ISO_EVENT_B",
      entity: "Control",
      entityId: sharedEntityId,
      changes: null,
    });

    const bAnchor = await prisma.auditLog.findFirst({
      where: { organizationId: b.org.id, action: "ISO_EVENT_B" },
    });
    const chain = await getAuditEventChain(prisma, b.org.id, bAnchor!.id, 3);
    expect(chain.every((c) => c.auditLog.organizationId === b.org.id)).toBe(true);
    expect(chain.map((c) => c.auditLog.action)).not.toContain("ISO_EVENT_A");
  });

  it("white-label isolation: org B cannot claim org A's domain, and settings writes stay home", async () => {
    const domain = `iso-${Date.now()}.example.com`;
    await callerFor(a.org.id, a.admin.id).whiteLabel.updateSettings({
      customDomain: domain,
    });
    await expect(
      callerFor(b.org.id, b.admin.id).whiteLabel.updateSettings({ customDomain: domain }),
    ).rejects.toThrow(/already claimed/);

    const bSettings = await prisma.organizationSettings.findUnique({
      where: { organizationId: b.org.id },
    });
    expect(bSettings?.whiteLabel ?? null).toBeNull();
  });

  it("MSSP grant isolation is covered in depth by mssp.router.test.ts — pin the static invariant here", () => {
    // The one sanctioned multi-org query file. Anything else in src/ building
    // an organizationId: { in: ... } filter is a review defect.
    const allowed = new Set([
      path.normalize("src/server/services/mssp/aggregateQuery.service.ts"),
    ]);
    const offenders: string[] = [];
    const pattern = /organizationId:\s*\{\s*in:/;

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          if (entry === "node_modules" || entry === ".next") continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          if (pattern.test(readFileSync(full, "utf8"))) {
            const rel = path.relative(process.cwd(), full);
            if (!allowed.has(path.normalize(rel))) offenders.push(rel);
          }
        }
      }
    };
    walk(path.resolve(process.cwd(), "src"));

    expect(offenders).toEqual([]);
  });
});
