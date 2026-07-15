// Phase 9 Part 3 — /api/v1/evidence
//   GET  (scope: evidence:read)  — list the org's evidence
//   POST (scope: evidence:write) — third party pushes evidence in, stored with
//        source "api" (mirrors Part 1's source "agent"). The referenced
//        control MUST belong to the key's org (verified via framework.
//        organizationId) — a control from another org is rejected 404, never
//        linked cross-tenant.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { withApiKey, apiError, parseListQuery, listResponse } from "../_lib/apiKeyAuth";
import { notifyEvidenceCreated } from "@/server/connectors/notify";

export async function GET(request: NextRequest) {
  return withApiKey(request, "evidence:read", async ({ organizationId }) => {
    const { limit, cursor } = parseListQuery(request);
    const controlId = request.nextUrl.searchParams.get("controlId") ?? undefined;
    const items = await prisma.evidence.findMany({
      where: {
        organizationId,
        ...(controlId ? { controlId } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      select: {
        id: true,
        controlId: true,
        fileName: true,
        type: true,
        source: true,
        summary: true,
        collectedAt: true,
      },
    });
    return listResponse(items, limit, (e) => e.id);
  });
}

const createEvidenceSchema = z.object({
  controlId: z.string().min(1),
  fileName: z.string().trim().min(1).max(512),
  type: z.enum(["SCREENSHOT", "POLICY_DOC", "API_RESPONSE", "LOG_EXCERPT", "CERTIFICATE", "OTHER"]),
  summary: z.string().max(5_000).optional(),
  /** Optional MinIO object key if the caller already uploaded a file. */
  filePath: z.string().max(1024).optional(),
});

export async function POST(request: NextRequest) {
  return withApiKey(request, "evidence:write", async ({ organizationId }) => {
    let body;
    try {
      body = createEvidenceSchema.parse(await request.json());
    } catch {
      return apiError(400, "Invalid evidence payload.");
    }

    // The control must belong to THIS org (via its framework). Cross-org
    // control id → 404, so we neither link cross-tenant nor confirm existence.
    const control = await prisma.control.findFirst({
      where: { id: body.controlId, framework: { organizationId } },
      select: { id: true },
    });
    if (!control) return apiError(404, "Control not found.");

    const evidence = await prisma.evidence.create({
      data: {
        organizationId,
        controlId: control.id,
        fileName: body.fileName,
        // If the caller didn't pre-upload a file, store a stable marker path.
        filePath: body.filePath ?? `api/${organizationId}/${randomUUID()}`,
        fileSizeBytes: 0,
        type: body.type,
        source: "api", // third source value alongside manual | auto | agent
        summary: body.summary,
      },
      select: { id: true, controlId: true, type: true, source: true, collectedAt: true },
    });

    // Optional webhook fan-out (reuses the existing dispatcher, evidence.created).
    await notifyEvidenceCreated(prisma, organizationId, {
      id: evidence.id,
      controlId: evidence.controlId,
      evidenceType: evidence.type,
    }).catch(() => undefined);

    return NextResponse.json({ data: evidence }, { status: 201 });
  });
}
