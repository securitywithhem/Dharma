// Phase 9 Part 3 — GET /api/v1/frameworks (scope: frameworks:read)
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { withApiKey, parseListQuery, listResponse } from "../_lib/apiKeyAuth";

export async function GET(request: NextRequest) {
  return withApiKey(request, "frameworks:read", async ({ organizationId }) => {
    const { limit, cursor } = parseListQuery(request);
    const items = await prisma.framework.findMany({
      where: { organizationId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        name: true,
        version: true,
        description: true,
        createdAt: true,
        _count: { select: { controls: true } },
      },
    });
    return listResponse(
      items.map((f) => ({
        id: f.id,
        name: f.name,
        version: f.version,
        description: f.description,
        controlCount: f._count.controls,
        createdAt: f.createdAt,
      })),
      limit,
      (f) => f.id,
    );
  });
}
