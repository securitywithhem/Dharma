// Phase 9 Part 1 — maps an endpoint posture check to a compliance Control.
//
// Follows the same fuzzy-keyword approach the Phase 4 EvidenceMapping feature
// uses (5_BACKEND_SCHEMA.md Connector/EvidenceMapping pattern): each checkType
// carries a set of keywords; we match them case-insensitively against the
// org's own control titles/descriptions. If nothing matches, the check is
// stored with controlId null and surfaced as an "unmapped check" in the UI —
// never guessed.
import type { PrismaClient } from "@prisma/client";

export const ENDPOINT_CHECK_TYPES = [
  "disk_encryption",
  "os_patch_level",
  "screen_lock",
  "firewall_status",
] as const;

export type EndpointCheckType = (typeof ENDPOINT_CHECK_TYPES)[number];

export function isEndpointCheckType(value: string): value is EndpointCheckType {
  return (ENDPOINT_CHECK_TYPES as readonly string[]).includes(value);
}

// Ordered keyword lists — more specific phrases first so the best match wins.
const CHECK_KEYWORDS: Record<EndpointCheckType, string[]> = {
  disk_encryption: ["encryption at rest", "disk encryption", "full disk", "encrypt", "encryption"],
  os_patch_level: ["patch management", "patch level", "software update", "vulnerability management", "patch"],
  screen_lock: ["screen lock", "session lock", "auto-lock", "session timeout", "idle timeout", "lock"],
  firewall_status: ["host firewall", "firewall", "network protection", "endpoint protection"],
};

/**
 * Human-readable label for UI, kept alongside the keywords so the two never
 * drift.
 */
export const CHECK_LABELS: Record<EndpointCheckType, string> = {
  disk_encryption: "Disk encryption",
  os_patch_level: "OS patch level",
  screen_lock: "Screen lock",
  firewall_status: "Firewall status",
};

/**
 * Resolves the best-matching controlId for a checkType within ONE organization.
 * Strictly org-scoped: only that org's controls are ever considered, so this
 * can never map an agent's check onto another tenant's control. Returns null
 * when no keyword matches (unmapped check).
 */
export async function mapCheckToControl(
  prisma: PrismaClient,
  organizationId: string,
  checkType: string,
): Promise<string | null> {
  if (!isEndpointCheckType(checkType)) return null;
  const keywords = CHECK_KEYWORDS[checkType];

  // Pull only this org's controls (join through Framework which is org-scoped).
  const controls = await prisma.control.findMany({
    where: { framework: { organizationId } },
    select: { id: true, title: true, description: true },
  });
  if (controls.length === 0) return null;

  // First keyword (most specific) that hits any control wins; within a keyword,
  // a title match beats a description-only match.
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    const titleHit = controls.find((c) => c.title.toLowerCase().includes(needle));
    if (titleHit) return titleHit.id;
    const descHit = controls.find((c) => (c.description ?? "").toLowerCase().includes(needle));
    if (descHit) return descHit.id;
  }

  return null;
}
