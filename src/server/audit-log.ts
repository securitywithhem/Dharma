import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

type AuditWriter = Pick<PrismaClient, "auditLog">;

type HashableAuditEntry = {
  organizationId: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  changes: unknown | null;
  timestamp: string;
  previousHash: string | null;
};

function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  return Object.keys(obj)
    .sort()
    .reduce((result: any, key) => {
      result[key] = sortObjectKeys(obj[key]);
      return result;
    }, {});
}

export function computeAuditHash(entry: HashableAuditEntry) {
  const deterministicEntry = {
    action: entry.action,
    changes: sortObjectKeys(entry.changes),
    entity: entry.entity,
    entityId: entry.entityId,
    organizationId: entry.organizationId,
    previousHash: entry.previousHash,
    timestamp: entry.timestamp,
    userId: entry.userId,
  };
  return createHash("sha256").update(JSON.stringify(deterministicEntry)).digest("hex");
}

export async function createAuditLog(
  prismaClient: AuditWriter,
  input: Omit<HashableAuditEntry, "timestamp" | "previousHash">,
) {
  const timestamp = new Date();
  const previous = await prismaClient.auditLog.findFirst({
    where: { organizationId: input.organizationId },
    orderBy: [{ timestamp: "desc" }, { createdAt: "desc" }]
  });

  const previousHash = previous?.currentHash ?? null;
  const currentHash = computeAuditHash({
    ...input,
    previousHash,
    timestamp: timestamp.toISOString()
  });

  return prismaClient.auditLog.create({
    data: {
      ...input,
      changes: input.changes ?? undefined,
      timestamp,
      previousHash,
      currentHash
    }
  });
}

export function verifyAuditChain(
  logs: Array<{
    id: string;
    organizationId: string;
    userId: string | null;
    action: string;
    entity: string;
    entityId: string;
    changes: unknown | null;
    timestamp: Date;
    previousHash: string | null;
    currentHash: string;
  }>,
) {
  for (let index = 0; index < logs.length; index += 1) {
    const current = logs[index];
    const previousHash = index === 0 ? null : logs[index - 1]?.currentHash ?? null;

    if (current.previousHash !== previousHash) {
      return {
        ok: false,
        brokenAtId: current.id,
        reason: "Previous hash mismatch"
      } as const;
    }

    const expectedHash = computeAuditHash({
      organizationId: current.organizationId,
      userId: current.userId,
      action: current.action,
      entity: current.entity,
      entityId: current.entityId,
      changes: current.changes,
      timestamp: current.timestamp.toISOString(),
      previousHash
    });

    if (expectedHash !== current.currentHash) {
      return {
        ok: false,
        brokenAtId: current.id,
        reason: "Current hash mismatch"
      } as const;
    }
  }

  return {
    ok: true,
    brokenAtId: null,
    reason: null
  } as const;
}
