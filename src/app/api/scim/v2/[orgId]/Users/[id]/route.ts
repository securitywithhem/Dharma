// Phase 8 Part 1 — SCIM 2.0 /Users/{id}: GET, PUT, PATCH, DELETE (soft-deactivate).
import { NextRequest, NextResponse } from "next/server";
import {
  withScimAuth,
  scimJson,
  readScimBody,
} from "@/server/services/scim/handler";
import {
  getScimUser,
  replaceScimUser,
  patchScimUser,
  deactivateScimUser,
} from "@/server/services/scim/scim.service";

type RouteParams = { params: { orgId: string; id: string } };

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId, baseUrl }) =>
    scimJson(await getScimUser(prisma, organizationId, params.id, baseUrl)),
  );
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId, baseUrl }) => {
    const body = await readScimBody<Record<string, unknown>>(request);
    return scimJson(
      await replaceScimUser(prisma, organizationId, params.id, body, baseUrl),
    );
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId, baseUrl }) => {
    const body = await readScimBody<{ Operations?: unknown }>(request);
    const operations = Array.isArray(body.Operations) ? body.Operations : [];
    return scimJson(
      await patchScimUser(prisma, organizationId, params.id, operations, baseUrl),
    );
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId }) => {
    await deactivateScimUser(prisma, organizationId, params.id);
    return new NextResponse(null, { status: 204 });
  });
}
