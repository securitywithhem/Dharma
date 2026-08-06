// WAVE 5.2 — validation for MarketplaceItem.metadata.
//
// The publish input previously declared `metadata: z.any()` and passed it
// straight into `db.marketplaceItem.create`. That JSON is not inert: other
// tenants import these items (MarketplaceService.importItem -> ImportedItem,
// and the framework-import path reads the structure back out), so unvalidated
// arbitrary JSON authored by one tenant became input to another tenant's
// compliance programme. Threat_Model.md lists exactly this as "not covered in
// source docs".
//
// One schema per ItemType, combined with a discriminated union so the shape is
// checked against the type the publisher declared rather than against a
// lowest-common-denominator object. Unknown keys are stripped (Zod's default
// for objects) rather than passed through, so a publisher cannot smuggle extra
// fields into the stored JSON.
import { z } from "zod";
import { ItemType } from "@prisma/client";

// Bounded everywhere. These are attacker-controlled sizes: without limits a
// single publish could store a multi-megabyte JSON blob that every importing
// tenant then materializes.
const shortText = z.string().min(1).max(300);
const longText = z.string().min(1).max(5_000);

/**
 * FRAMEWORK — a control set another tenant can import as their own framework.
 * The control tree is the part that actually becomes tenant data, so it is the
 * part that most needs a shape.
 */
const frameworkControlSchema = z.object({
  identifier: shortText,
  title: shortText,
  domain: shortText,
  description: longText.optional(),
  // Nesting is expressed by parentIdentifier rather than by an actual nested
  // array, matching how importFramework reconstructs the hierarchy and keeping
  // the payload non-recursive (so depth cannot be used to blow the parser).
  parentIdentifier: shortText.optional(),
});

const frameworkMetadataSchema = z.object({
  frameworkName: shortText,
  frameworkVersion: shortText.optional(),
  controls: z.array(frameworkControlSchema).min(1).max(2_000),
});

/** TEMPLATE — a policy/document template rendered into the importer's tenant. */
const templateMetadataSchema = z.object({
  format: z.enum(["markdown", "html"]),
  body: z.string().min(1).max(200_000),
  // Placeholders the importing tenant is expected to fill in.
  variables: z.array(shortText).max(100).optional(),
});

/**
 * CONNECTOR — a connector *definition*, never a credential.
 *
 * Explicitly no secret/token/credential field: connector secrets live
 * AES-256-GCM-encrypted in Connector.config via connectorVault.ts
 * (04_TECHNICAL/Security_Architecture.md), and a published, world-readable
 * marketplace item is the last place one should be able to appear.
 */
const connectorMetadataSchema = z.object({
  connectorType: shortText,
  documentationUrl: z.string().url().max(2_000).optional(),
  // Names only — the importing tenant supplies the values through the
  // connector vault, so nothing sensitive is carried by the item itself.
  requiredConfigKeys: z.array(shortText).max(50).optional(),
});

export const marketplaceMetadataSchema = z.discriminatedUnion("kind", [
  frameworkMetadataSchema.extend({ kind: z.literal(ItemType.FRAMEWORK) }),
  templateMetadataSchema.extend({ kind: z.literal(ItemType.TEMPLATE) }),
  connectorMetadataSchema.extend({ kind: z.literal(ItemType.CONNECTOR) }),
]);

export type MarketplaceMetadata = z.infer<typeof marketplaceMetadataSchema>;

/**
 * Validate metadata against the declared ItemType.
 *
 * `kind` is injected from the item's `type` rather than trusted from the
 * payload, so a publisher cannot declare type=CONNECTOR while shipping a
 * FRAMEWORK's control tree past the connector schema.
 */
export function parseMarketplaceMetadata(
  type: ItemType,
  metadata: unknown
): MarketplaceMetadata {
  return marketplaceMetadataSchema.parse({
    ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
    kind: type,
  });
}
