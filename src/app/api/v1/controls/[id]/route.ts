// Phase 9 Part 3 — GET /api/v1/controls/:id (scope: controls:read)
// Cross-org access returns 404 (not 403) — never leak the existence of
// another org's resource.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withApiKey, apiError } from "../../_lib/apiKeyAuth";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiKey(request, "controls:read", async ({ organizationId }) => {
    const control = await prisma.control.findFirst({
      where: { id: params.id, framework: { organizationId } },
      select: {
        id: true,
        frameworkId: true,
        domain: true,
        title: true,
        description: true,
        guidance: true,
        status: true,
        code: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!control) return apiError(404, "Control not found.");
    return NextResponse.json({ data: control });
  });
}
