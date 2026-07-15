// Phase 8 Part 1 — SCIM 2.0 /Groups/{id}: GET, PATCH (membership/rename), DELETE.
import { NextRequest, NextResponse } from "next/server";
import {
  withScimAuth,
  scimJson,
  readScimBody,
} from "@/server/services/scim/handler";
import {
  getScimGroup,
  patchScimGroup,
  deleteScimGroup,
} from "@/server/services/scim/scim.service";

type RouteParams = { params: { orgId: string; id: string } };

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId, baseUrl }) =>
    scimJson(await getScimGroup(prisma, organizationId, params.id, baseUrl)),
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId, baseUrl }) => {
    const body = await readScimBody<{ Operations?: unknown }>(request);
    const operations = Array.isArray(body.Operations) ? body.Operations : [];
    return scimJson(
      await patchScimGroup(prisma, organizationId, params.id, operations, baseUrl),
    );
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId }) => {
    await deleteScimGroup(prisma, organizationId, params.id);
    return new NextResponse(null, { status: 204 });
  });
}
