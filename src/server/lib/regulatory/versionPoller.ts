// Phase 9 Part 3 — regulatory version publishing + external-source stub.
//
// There is no PRD-specified external regulatory data feed, and the PRD's
// "Out of Scope" section cautions against overbuilding unscoped integrations.
// So the PRIMARY mechanism is admin-publishable: a Dharma admin publishes a
// new FrameworkVersion (via the internal `regulatory.publishVersion` tool),
// which computes a diff against the previous version and fans out alerts.
//
// The external-source hook below is a deliberate stub — it does NOT fabricate
// a fake third-party API. When a real official feed is wired up later, this
// is the single seam to implement.
import type { PrismaClient } from "@prisma/client";
import { diffControlSnapshots, type FrameworkDiff } from "./diffEngine";

export interface FetchedOfficialVersion {
  version: string;
  changelog: string;
  controlsSnapshot: unknown;
}

/**
 * TODO(external-source): wire a real official regulatory feed (e.g. an
 * ISO/AICPA/HHS change endpoint or a monitored publication URL) here. Until
 * then this returns null — the app relies on admin-published versions and
 * must never invent version data.
 */
export async function fetchLatestOfficialVersion(
  _frameworkSlug: string,
): Promise<FetchedOfficialVersion | null> {
  return null;
}

export interface PublishVersionResult {
  frameworkVersionId: string;
  isFirstVersion: boolean;
  diff: FrameworkDiff | null; // null for the very first version (nothing to diff against)
}

/**
 * Persists a new FrameworkVersion for a framework MarketplaceItem and computes
 * the diff against the immediately-previous version (by publishedAt). Returns
 * the version id + diff; the CALLER enqueues fanout (keeps this pure-ish and
 * unit-testable without a queue). The unique [marketplaceItemId, version]
 * constraint prevents duplicate publishes.
 */
export async function publishFrameworkVersion(
  prisma: PrismaClient,
  input: {
    marketplaceItemId: string;
    version: string;
    changelog: string;
    controlsSnapshot: unknown;
  },
): Promise<PublishVersionResult> {
  const previous = await prisma.frameworkVersion.findFirst({
    where: { marketplaceItemId: input.marketplaceItemId },
    orderBy: { publishedAt: "desc" },
  });

  const created = await prisma.frameworkVersion.create({
    data: {
      marketplaceItemId: input.marketplaceItemId,
      version: input.version,
      changelog: input.changelog,
      controlsSnapshot: input.controlsSnapshot as never,
    },
  });

  const diff = previous
    ? diffControlSnapshots(previous.controlsSnapshot, input.controlsSnapshot)
    : null;

  return {
    frameworkVersionId: created.id,
    isFirstVersion: !previous,
    diff,
  };
}
