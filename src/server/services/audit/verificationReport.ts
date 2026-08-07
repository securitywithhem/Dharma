// GH #26 — render and sign the verification artefact, then store it.
//
// Uses the existing signed-report pipeline (src/lib/pdf/pdfSigner.ts) rather
// than a second one, as the issue asked: an auditor should be able to verify
// this document's signature exactly the way they verify a compliance report's.
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { PrismaClient } from "@prisma/client";

import { minioClient } from "@/server/minio";
import { signPdf } from "@/lib/pdf/pdfSigner";
import { ChainVerificationDocument } from "@/lib/pdf/ChainVerificationDocument";
import type { ChainVerificationResult } from "@/server/services/audit/chainVerification";

const BUCKET_NAME = process.env.MINIO_BUCKET_NAME || "dharma-evidence";

/**
 * Build, sign and store the report. Returns the object key.
 *
 * Returns the KEY, not a presigned URL, deliberately. The row this key is
 * written to outlives any presigned URL's 7-day expiry, so storing a URL would
 * give us a record that silently becomes a dead link — precisely the failure an
 * auditor hits when they come back to a verification from six months ago. The
 * URL is minted on demand at download time instead.
 */
export async function buildSignedVerificationReport(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    verificationId: string;
    result: ChainVerificationResult;
  },
): Promise<string> {
  const [org, verification] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true },
    }),
    prisma.auditChainVerification.findUnique({
      where: { id: input.verificationId },
      select: { trigger: true },
    }),
  ]);

  const pdf = await renderToBuffer(
    React.createElement(ChainVerificationDocument, {
      data: {
        organizationName: org?.name ?? "Unknown organization",
        ok: input.result.ok,
        reason: input.result.reason,
        brokenAtId: input.result.brokenAtId,
        brokenAtTimestamp: input.result.brokenAtTimestamp,
        totalChecked: input.result.totalChecked,
        rangeFrom: input.result.rangeFrom,
        rangeTo: input.result.rangeTo,
        checkedAt: input.result.checkedAt,
        partial: input.result.partial,
        trigger: verification?.trigger ?? "MANUAL",
        verificationId: input.verificationId,
      },
      // `as never` matches reportWorker.ts's existing call convention.
      // @react-pdf/renderer types renderToBuffer as taking a ReactElement whose
      // props extend DocumentProps, which no document component in this repo
      // satisfies — they take their own data props and render <Document>
      // internally. Casting at the call site rather than widening the component
      // props, which would make the type lie about what it accepts.
    }) as never,
  );

  const { signedBuffer } = await signPdf(pdf, input.organizationId);

  // Its own prefix, not reports/: these are attestations about the audit log
  // rather than compliance reports, and a retention or lifecycle rule applied
  // to one must not silently sweep the other.
  const objectKey = `audit-verification/${input.organizationId}/${input.verificationId}.pdf`;

  await minioClient.putObject(BUCKET_NAME, objectKey, signedBuffer, signedBuffer.length, {
    "Content-Type": "application/pdf",
    "Cache-Control": "no-cache",
  });

  return objectKey;
}
