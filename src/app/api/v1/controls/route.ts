// Phase 9 Part 3 — GET /api/v1/controls (scope: controls:read)
// Controls are org-scoped through their Framework (Control has no direct
// organizationId), so the filter goes through framework.organizationId — the
// org from the API key, never a client param.
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { withApiKey, parseListQuery, listResponse } from "../_lib/apiKeyAuth";

export async function GET(request: NextRequest) {
  return withApiKey(request, "controls:read", async ({ organizationId }) => {
    const { limit, cursor } = parseListQuery(request);
    const items = await prisma.control.findMany({
      where: {
        framework: { organizationId },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        frameworkId: true,
        domain: true,
        title: true,
        status: true,
        code: true,
        updatedAt: true,
      },
    });
    return listResponse(items, limit, (c) => c.id);
  });
}
