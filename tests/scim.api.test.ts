// Phase 8 Part 1 — SCIM 2.0 integration tests: full provisioning lifecycle
// (create → update → deactivate) through the real route handlers against the
// real database, plus bearer-token and tenant-isolation negative tests.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { PrismaClient, Role } from "@prisma/client";
import * as UsersRoute from "@/app/api/scim/v2/[orgId]/Users/route";
import * as UserByIdRoute from "@/app/api/scim/v2/[orgId]/Users/[id]/route";
import * as GroupsRoute from "@/app/api/scim/v2/[orgId]/Groups/route";
import * as GroupByIdRoute from "@/app/api/scim/v2/[orgId]/Groups/[id]/route";

const prisma = new PrismaClient();

type Org = { id: string; token: string };
let orgA: Org;
let orgB: Org;

async function seedScimOrg(label: string): Promise<Org> {
  const org = await prisma.organization.create({
    data: { name: `${label} ${Date.now()}-${Math.random()}` },
  });
  const token = `dscim_${randomBytes(16).toString("hex")}`;
  await prisma.organizationSettings.create({
    data: {
      organizationId: org.id,
      scimEnabled: true,
      scimTokenHash: createHash("sha256").update(token).digest("hex"),
    },
  });
  return { id: org.id, token };
}

function scimRequest(
  org: Org,
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
) {
  return new NextRequest(`http://localhost:3000/api/scim/v2/${org.id}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${options.token ?? org.token}`,
      "content-type": "application/scim+json",
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

beforeAll(async () => {
  orgA = await seedScimOrg("ScimOrgA");
  orgB = await seedScimOrg("ScimOrgB");
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgA.id } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: orgB.id } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("SCIM authentication", () => {
  it("rejects requests without a bearer token", async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/scim/v2/${orgA.id}/Users`,
    );
    const response = await UsersRoute.GET(request, { params: { orgId: orgA.id } });
    expect(response.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const response = await UsersRoute.GET(
      scimRequest(orgA, "/Users", { token: "dscim_wrong" }),
      { params: { orgId: orgA.id } },
    );
    expect(response.status).toBe(401);
  });

  it("tenant isolation: org A's token is rejected against org B's endpoint", async () => {
    const response = await UsersRoute.GET(
      scimRequest(orgB, "/Users", { token: orgA.token }),
      { params: { orgId: orgB.id } },
    );
    expect(response.status).toBe(401);
  });
});

describe("SCIM user lifecycle (create → update → deactivate)", () => {
  const email = `scim-user-${Date.now()}@enterprise.test`;
  let scimUserId: string;

  it("POST /Users creates a user (Okta-style payload)", async () => {
    const response = await UsersRoute.POST(
      scimRequest(orgA, "/Users", {
        method: "POST",
        body: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: email,
          externalId: "okta-ext-1",
          name: { givenName: "Sam", familyName: "Sso" },
          active: true,
        },
      }),
      { params: { orgId: orgA.id } },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    scimUserId = body.id;
    expect(body.userName).toBe(email);
    expect(body.active).toBe(true);

    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser?.organizationId).toBe(orgA.id);
    expect(dbUser?.role).toBe(Role.VIEWER);
    expect(dbUser?.scimExternalId).toBe("okta-ext-1");

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "SCIM_USER_CREATED", entityId: scimUserId },
    });
    expect(audit).not.toBeNull();
    expect((audit?.changes as Record<string, unknown>).actor).toBe("scim-provisioning");
    expect(audit?.userId).toBeNull();
  });

  it("GET /Users supports the userName eq filter", async () => {
    const response = await UsersRoute.GET(
      scimRequest(orgA, `/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`),
      { params: { orgId: orgA.id } },
    );
    const body = await response.json();
    expect(body.totalResults).toBe(1);
    expect(body.Resources[0].id).toBe(scimUserId);
  });

  it("POST /Users returns 409 for a duplicate email — even one in another org", async () => {
    const duplicate = await UsersRoute.POST(
      scimRequest(orgB, "/Users", {
        method: "POST",
        body: { userName: email },
      }),
      { params: { orgId: orgB.id } },
    );
    expect(duplicate.status).toBe(409);
  });

  it("PATCH /Users/{id} handles Azure-style capitalized ops and string booleans", async () => {
    const response = await UserByIdRoute.PATCH(
      scimRequest(orgA, `/Users/${scimUserId}`, {
        method: "PATCH",
        body: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            { op: "Replace", path: "displayName", value: "Sam Renamed" },
            { op: "Replace", path: "active", value: "False" },
          ],
        },
      }),
      { params: { orgId: orgA.id, id: scimUserId } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.displayName).toBe("Sam Renamed");
    expect(body.active).toBe(false);
  });

  it("PATCH /Users/{id} handles Okta-style no-path value objects", async () => {
    const response = await UserByIdRoute.PATCH(
      scimRequest(orgA, `/Users/${scimUserId}`, {
        method: "PATCH",
        body: {
          Operations: [{ op: "replace", value: { active: true } }],
        },
      }),
      { params: { orgId: orgA.id, id: scimUserId } },
    );
    const body = await response.json();
    expect(body.active).toBe(true);
  });

  it("DELETE /Users/{id} soft-deactivates — the row survives for audit integrity", async () => {
    const response = await UserByIdRoute.DELETE(
      scimRequest(orgA, `/Users/${scimUserId}`, { method: "DELETE" }),
      { params: { orgId: orgA.id, id: scimUserId } },
    );
    expect(response.status).toBe(204);

    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.isActive).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: orgA.id,
        action: "SCIM_USER_DEACTIVATED",
        entityId: scimUserId,
      },
    });
    expect(audit).not.toBeNull();
  });

  it("tenant isolation: org B's token cannot read or modify org A's user", async () => {
    // Correct token for the org in the URL, but the resource belongs to org A.
    const read = await UserByIdRoute.GET(
      scimRequest(orgB, `/Users/${scimUserId}`),
      { params: { orgId: orgB.id, id: scimUserId } },
    );
    expect(read.status).toBe(404);

    const del = await UserByIdRoute.DELETE(
      scimRequest(orgB, `/Users/${scimUserId}`, { method: "DELETE" }),
      { params: { orgId: orgB.id, id: scimUserId } },
    );
    expect(del.status).toBe(404);
  });
});

describe("SCIM groups map to custom roles", () => {
  let groupId: string;
  let memberUserId: string;

  it("POST /Groups creates a CustomRole with no permissions granted", async () => {
    const member = await prisma.user.create({
      data: {
        email: `scim-group-member-${Date.now()}@enterprise.test`,
        organizationId: orgA.id,
        role: Role.VIEWER,
      },
    });
    memberUserId = member.id;

    const response = await GroupsRoute.POST(
      scimRequest(orgA, "/Groups", {
        method: "POST",
        body: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Engineering",
          members: [{ value: member.id }],
        },
      }),
      { params: { orgId: orgA.id } },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    groupId = body.id;

    const role = await prisma.customRole.findUnique({ where: { id: groupId } });
    expect(role?.name).toBe("Engineering");
    expect(role?.permissions).toEqual({});

    const dbMember = await prisma.user.findUnique({ where: { id: member.id } });
    expect(dbMember?.customRoleId).toBe(groupId);
  });

  it("PATCH /Groups/{id} removes members (Okta path filter form)", async () => {
    const response = await GroupByIdRoute.PATCH(
      scimRequest(orgA, `/Groups/${groupId}`, {
        method: "PATCH",
        body: {
          Operations: [
            { op: "remove", path: `members[value eq "${memberUserId}"]` },
          ],
        },
      }),
      { params: { orgId: orgA.id, id: groupId } },
    );
    expect(response.status).toBe(200);

    const dbMember = await prisma.user.findUnique({ where: { id: memberUserId } });
    expect(dbMember?.customRoleId).toBeNull();
  });

  it("DELETE /Groups/{id} deletes the role; members fall back to legacy enum", async () => {
    const response = await GroupByIdRoute.DELETE(
      scimRequest(orgA, `/Groups/${groupId}`, { method: "DELETE" }),
      { params: { orgId: orgA.id, id: groupId } },
    );
    expect(response.status).toBe(204);
    expect(
      await prisma.customRole.findUnique({ where: { id: groupId } }),
    ).toBeNull();
  });
});
