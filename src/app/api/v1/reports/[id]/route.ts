// Phase 9 Part 3 — GET /api/v1/reports/:id (scope: reports:read)
// Returns report metadata + a fresh presigned download URL when COMPLETED.
// Cross-org id → 404.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withApiKey, apiError } from "../../_lib/apiKeyAuth";
import { generatePresignedDownloadUrl } from "@/server/minio";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiKey(request, "reports:read", async ({ organizationId }) => {
    const report = await prisma.report.findFirst({
      where: { id: params.id, organizationId },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        fileUrl: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!report) return apiError(404, "Report not found.");

    let downloadUrl: string | null = null;
    if (report.status === "COMPLETED" && report.fileUrl) {
      downloadUrl = await generatePresignedDownloadUrl(report.fileUrl, 15 * 60);
    }
    const { fileUrl: _omit, ...rest } = report;
    return NextResponse.json({ data: { ...rest, downloadUrl } });
  });
}
