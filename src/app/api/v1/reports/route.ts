// Phase 9 Part 3 — GET /api/v1/reports (scope: reports:read)
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { withApiKey, parseListQuery, listResponse } from "../_lib/apiKeyAuth";

export async function GET(request: NextRequest) {
  return withApiKey(request, "reports:read", async ({ organizationId }) => {
    const { limit, cursor } = parseListQuery(request);
    const items = await prisma.report.findMany({
      where: { organizationId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return listResponse(items, limit, (r) => r.id);
  });
}
