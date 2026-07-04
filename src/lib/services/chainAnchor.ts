/**
 * src/lib/services/chainAnchor.ts
 *
 * Phase 2 Feature 3 — External Audit Chain Anchoring Service.
 *
 * Three public functions:
 *   computeRootHash  – derives a single root hash from the org's full AuditLog chain
 *   anchorRootHash   – writes the root hash to WORM storage + DB + optional public ledger
 *   verifyAgainstStoredAnchor – round-trips to WORM store to prove the local chain hasn't drifted
 *
 * [skills: backend-dev-guidelines, sast-configuration]
 */

import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { verifyAuditChain, computeAuditHash } from "@/server/audit-log";
import { putAnchorObject, getAnchorObject } from "@/server/anchorMinio";
import { env } from "@/env";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface RootHashResult {
  rootHash: string;
  recordCount: number;
  fromLogId: string;
  toLogId: string;
}

export interface AnchorManifest {
  organizationId: string;
  rootHash: string;
  recordCount: number;
  fromLogId: string;
  toLogId: string;
  anchoredAt: string; // ISO 8601
}

// ------------------------------------------------------------------
// computeRootHash
// ------------------------------------------------------------------

/**
 * Loads all AuditLog entries for an org (ascending order), verifies the chain,
 * and returns a single root hash representing the full current state.
 *
 * The root hash is SHA-256(lastEntry.currentHash + recordCount + orgId)
 * so it encodes both chain integrity AND count, making length-extension attacks
 * harder to fake than raw last-hash.
 */
export async function computeRootHash(
  prisma: PrismaClient,
  organizationId: string,
): Promise<RootHashResult> {
  const logs = await prisma.auditLog.findMany({
    where: { organizationId },
    orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      organizationId: true,
      userId: true,
      action: true,
      entity: true,
      entityId: true,
      changes: true,
      timestamp: true,
      previousHash: true,
      currentHash: true,
    },
  });

  if (logs.length === 0) {
    return {
      rootHash: createHash("sha256")
        .update(`empty:${organizationId}`)
        .digest("hex"),
      recordCount: 0,
      fromLogId: "",
      toLogId: "",
    };
  }

  const result = verifyAuditChain(logs);
  if (!result.ok) {
    throw new Error(
      `[chainAnchor] Audit chain is already broken before anchoring — cannot anchor a tampered chain. ` +
        `First broken entry: ${result.brokenAtId} — reason: ${result.reason}`,
    );
  }

  const lastLog = logs[logs.length - 1]!;
  const rootHash = createHash("sha256")
    .update(`root:${lastLog.currentHash}:${logs.length}:${organizationId}`)
    .digest("hex");

  return {
    rootHash,
    recordCount: logs.length,
    fromLogId: logs[0]!.id,
    toLogId: lastLog.id,
  };
}

// ------------------------------------------------------------------
// anchorRootHash
// ------------------------------------------------------------------

/**
 * Full anchoring pipeline:
 *   1. Compute root hash (and verify chain health first).
 *   2. Write a JSON manifest to the WORM anchor bucket.
 *   3. Optionally submit to OpenTimestamps public ledger (if PUBLIC_ANCHOR_ENABLED).
 *   4. Persist a ChainAnchor DB row linking the manifest back to the org.
 *
 * Returns the created ChainAnchor record.
 */
export async function anchorRootHash(
  prisma: PrismaClient,
  organizationId: string,
) {
  const { rootHash, recordCount, fromLogId, toLogId } = await computeRootHash(
    prisma,
    organizationId,
  );

  const anchoredAt = new Date();
  const storageKey = `anchors/${organizationId}/${anchoredAt.toISOString().replace(/[:.]/g, "-")}-${rootHash.slice(0, 16)}.json`;

  const manifest: AnchorManifest = {
    organizationId,
    rootHash,
    recordCount,
    fromLogId,
    toLogId,
    anchoredAt: anchoredAt.toISOString(),
  };

  // Write to WORM bucket (this is the critical integrity step)
  await putAnchorObject(storageKey, JSON.stringify(manifest, null, 2));

  // Optional public ledger (OpenTimestamps REST calendar)
  let publicProof: string | null = null;
  if (env.PUBLIC_ANCHOR_ENABLED && recordCount > 0) {
    publicProof = await submitToOpenTimestamps(rootHash, storageKey);
  }

  // Persist DB row
  const anchor = await prisma.chainAnchor.create({
    data: {
      organizationId,
      rootHash,
      recordCount,
      fromLogId,
      toLogId,
      anchoredAt,
      storageKey,
      publicProof,
    },
  });

  console.log(
    `✅ [chainAnchor] Anchored ${recordCount} logs for org ${organizationId} → ${storageKey}`,
  );

  return anchor;
}

// ------------------------------------------------------------------
// verifyAgainstStoredAnchor
// ------------------------------------------------------------------

/**
 * Fetches the anchor object from WORM storage (not just from the DB),
 * then recomputes the current chain root and compares.
 *
 * The round-trip to remote storage is the key proof: if an attacker
 * dropped the Postgres row and re-created it with a forged hash,
 * the WORM object at `storageKey` would still contain the original.
 */
export async function verifyAgainstStoredAnchor(
  prisma: PrismaClient,
  anchorId: string,
  organizationId: string,
): Promise<{ matchesStoredAnchor: boolean; anchor: AnchorManifest; currentRootHash: string }> {
  // Load the DB row to get the storage key
  const dbAnchor = await prisma.chainAnchor.findFirst({
    where: { id: anchorId, organizationId },
  });
  if (!dbAnchor) {
    throw new Error(`[chainAnchor] Anchor ${anchorId} not found for org ${organizationId}`);
  }

  // Fetch the manifest from WORM storage (this is the authoritative source)
  let storedManifest: AnchorManifest;
  try {
    const raw = await getAnchorObject(dbAnchor.storageKey);
    storedManifest = JSON.parse(raw) as AnchorManifest;
  } catch (err) {
    throw new Error(
      `[chainAnchor] Failed to retrieve anchor manifest from WORM storage (${dbAnchor.storageKey}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Recompute the root hash from the live chain
  const { rootHash: currentRootHash } = await computeRootHash(prisma, organizationId);

  return {
    matchesStoredAnchor: currentRootHash === storedManifest.rootHash,
    anchor: storedManifest,
    currentRootHash,
  };
}

// ------------------------------------------------------------------
// OpenTimestamps helper (public ledger, optional)
// ------------------------------------------------------------------

/**
 * Submits a SHA-256 hash to an OpenTimestamps calendar server.
 * Returns the receipt path stored in the anchor bucket, or null on failure.
 * Never throws — if OTS is unavailable the anchor is still written to WORM.
 */
async function submitToOpenTimestamps(
  rootHash: string,
  baseKey: string,
): Promise<string | null> {
  try {
    // OpenTimestamps expects the raw digest bytes (not hex string) as the request body
    const hashBytes = Buffer.from(rootHash, "hex");
    const response = await fetch(
      "https://alice.btc.calendar.opentimestamps.org/digest",
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: hashBytes,
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      console.warn(`[chainAnchor] OpenTimestamps returned ${response.status} — skipping public anchor`);
      return null;
    }

    const otsBytes = Buffer.from(await response.arrayBuffer());
    const receiptKey = `${baseKey}.ots`;

    // Store the OTS receipt in the anchor bucket alongside the manifest
    await putAnchorObject(receiptKey, otsBytes.toString("base64"));
    console.log(`✅ [chainAnchor] OpenTimestamps receipt stored at ${receiptKey}`);
    return receiptKey;
  } catch (err) {
    console.warn(
      `[chainAnchor] OpenTimestamps submission failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
