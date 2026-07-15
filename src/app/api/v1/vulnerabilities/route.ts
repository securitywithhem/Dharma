// Phase 9 Part 3 — GET /api/v1/vulnerabilities (scope: vulnerabilities:read)
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { withApiKey, parseListQuery, listResponse } from "../_lib/apiKeyAuth";

export async function GET(request: NextRequest) {
  return withApiKey(request, "vulnerabilities:read", async ({ organizationId }) => {
    const { limit, cursor } = parseListQuery(request);
    const severity = request.nextUrl.searchParams.get("severity") ?? undefined;
    const status = request.nextUrl.searchParams.get("status") ?? undefined;

    const items = await prisma.vulnerability.findMany({
      where: {
        organizationId,
        ...(severity ? { severity: severity as never } : {}),
        ...(status ? { status: status as never } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        controlId: true,
        cvssScore: true,
        createdAt: true,
      },
    });
    return listResponse(items, limit, (v) => v.id);
  });
}
