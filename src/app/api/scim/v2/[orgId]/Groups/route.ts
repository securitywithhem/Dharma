// Phase 8 Part 1 — SCIM 2.0 /Groups collection (mapped to CustomRole).
import { NextRequest } from "next/server";
import {
  withScimAuth,
  scimJson,
  parseListParams,
  readScimBody,
} from "@/server/services/scim/handler";
import {
  listScimGroups,
  createScimGroup,
} from "@/server/services/scim/scim.service";

export async function GET(
  request: NextRequest,
  { params }: { params: { orgId: string } },
) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId, baseUrl }) =>
    scimJson(
      await listScimGroups(prisma, organizationId, parseListParams(request), baseUrl),
    ),
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: { orgId: string } },
) {
  return withScimAuth(request, params.orgId, async ({ prisma, organizationId, baseUrl }) => {
    const body = await readScimBody<Record<string, unknown>>(request);
    return scimJson(await createScimGroup(prisma, organizationId, body, baseUrl), 201);
  });
}
