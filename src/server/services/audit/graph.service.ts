// Phase 8 Part 2 — audit event correlation graph.
//
// Reuses Phase 7's OrgGraphNode/OrgGraphEdge tables (the org knowledge
// graph the AI Advisor ingestion built) instead of standing up a second
// graph store: each audit event becomes
//   Actor -[performed]-> AuditEvent -[on]-> Resource
// nodes/edges, org-scoped. getAuditEventChain() then answers "what happened
// around this event" by walking the graph N hops PLUS a temporal join
// (same actor within a session window; same resource across time), which
// powers the "Related events" panel — the flat filterable table stays the
// primary view per UI_UX.md.
import type { AuditLog, PrismaClient } from "@prisma/client";

const NODE_ACTOR = "auditActor";
const NODE_EVENT = "auditEvent";
const NODE_RESOURCE = "auditResource";

export const SESSION_WINDOW_MS = 30 * 60 * 1000;

async function findOrCreateNode(
  prisma: PrismaClient,
  organizationId: string,
  nodeType: string,
  label: string,
  metadata: Record<string, unknown>,
) {
  const existing = await prisma.orgGraphNode.findFirst({
    where: { organizationId, nodeType, label },
  });
  if (existing) return existing;
  return prisma.orgGraphNode.create({
    data: { organizationId, nodeType, label, metadata: metadata as object },
  });
}

/** Feeds one written audit row into the correlation graph. Never throws. */
export async function ingestAuditEventToGraph(
  prisma: PrismaClient,
  log: AuditLog,
): Promise<void> {
  const actorLabel = log.userId ?? "system";
  const resourceLabel = `${log.entity}:${log.entityId}`;

  const [actorNode, resourceNode] = await Promise.all([
    findOrCreateNode(prisma, log.organizationId, NODE_ACTOR, actorLabel, {
      userId: log.userId,
    }),
    findOrCreateNode(prisma, log.organizationId, NODE_RESOURCE, resourceLabel, {
      entity: log.entity,
      entityId: log.entityId,
    }),
  ]);

  const eventNode = await prisma.orgGraphNode.create({
    data: {
      organizationId: log.organizationId,
      nodeType: NODE_EVENT,
      label: log.action,
      metadata: {
        auditLogId: log.id,
        action: log.action,
        timestamp: log.timestamp.toISOString(),
      },
    },
  });

  await prisma.orgGraphEdge.createMany({
    data: [
      {
        organizationId: log.organizationId,
        fromNodeId: actorNode.id,
        toNodeId: eventNode.id,
        relation: "performed",
      },
      {
        organizationId: log.organizationId,
        fromNodeId: eventNode.id,
        toNodeId: resourceNode.id,
        relation: "on",
      },
    ],
  });
}

export type RelatedAuditEvent = {
  auditLog: AuditLog & { user: { id: string; name: string | null; email: string } | null };
  /** Why this event is in the chain. */
  via: "graph" | "same-actor-session" | "same-resource";
  hop: number;
};

/**
 * Walks the correlation graph `hops` steps out from the given audit event
 * and merges in temporally-correlated events (same actor within the session
 * window, same resource over time). Strictly org-scoped: the anchor event
 * must belong to organizationId, and every traversal is filtered to it.
 */
export async function getAuditEventChain(
  prisma: PrismaClient,
  organizationId: string,
  auditLogId: string,
  hops = 2,
): Promise<RelatedAuditEvent[]> {
  const anchor = await prisma.auditLog.findFirst({
    where: { id: auditLogId, organizationId },
  });
  if (!anchor) return [];

  const related = new Map<string, { via: RelatedAuditEvent["via"]; hop: number }>();

  // --- 1. Graph walk ------------------------------------------------------
  const anchorNode = await prisma.orgGraphNode.findFirst({
    where: {
      organizationId,
      nodeType: NODE_EVENT,
      metadata: { path: ["auditLogId"], equals: auditLogId },
    },
  });

  if (anchorNode) {
    let frontier = [anchorNode.id];
    const visited = new Set<string>(frontier);

    for (let hop = 1; hop <= hops && frontier.length > 0; hop += 1) {
      const edges = await prisma.orgGraphEdge.findMany({
        where: {
          organizationId,
          OR: [{ fromNodeId: { in: frontier } }, { toNodeId: { in: frontier } }],
        },
        include: { fromNode: true, toNode: true },
      });

      const next: string[] = [];
      for (const edge of edges) {
        for (const node of [edge.fromNode, edge.toNode]) {
          if (visited.has(node.id)) continue;
          visited.add(node.id);
          next.push(node.id);
          if (node.nodeType === NODE_EVENT) {
            const meta = node.metadata as { auditLogId?: string } | null;
            if (meta?.auditLogId && meta.auditLogId !== auditLogId) {
              const existing = related.get(meta.auditLogId);
              if (!existing || existing.hop > hop) {
                related.set(meta.auditLogId, { via: "graph", hop });
              }
            }
          }
        }
      }
      frontier = next;
    }
  }

  // --- 2. Temporal correlation --------------------------------------------
  const windowStart = new Date(anchor.timestamp.getTime() - SESSION_WINDOW_MS);
  const windowEnd = new Date(anchor.timestamp.getTime() + SESSION_WINDOW_MS);

  if (anchor.userId) {
    const sameActor = await prisma.auditLog.findMany({
      where: {
        organizationId,
        userId: anchor.userId,
        id: { not: anchor.id },
        timestamp: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true },
      take: 50,
    });
    for (const row of sameActor) {
      if (!related.has(row.id)) {
        related.set(row.id, { via: "same-actor-session", hop: 1 });
      }
    }
  }

  const sameResource = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entity: anchor.entity,
      entityId: anchor.entityId,
      id: { not: anchor.id },
    },
    orderBy: { timestamp: "desc" },
    select: { id: true },
    take: 50,
  });
  for (const row of sameResource) {
    if (!related.has(row.id)) {
      related.set(row.id, { via: "same-resource", hop: 1 });
    }
  }

  if (related.size === 0) return [];

  const rows = await prisma.auditLog.findMany({
    where: { id: { in: [...related.keys()] }, organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { timestamp: "asc" },
  });

  return rows.map((auditLog) => {
    const info = related.get(auditLog.id)!;
    return { auditLog, via: info.via, hop: info.hop };
  });
}
