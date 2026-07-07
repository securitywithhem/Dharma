import { prisma } from '@/server/db';
import { TRPCError } from '@trpc/server';
import { EntitlementService } from './entitlement';
import { MarketplaceService } from './marketplace';
import crypto from 'crypto';

export interface ImportFrameworkInput {
  marketplaceItemId: string;
  organizationId: string;
  userId?: string;
  frameworkNameOverride?: string;
}

export class ImportService {
  /**
   * Check if a framework can be imported (entitlements, duplicates, etc.)
   */
  static async validateImport(organizationId: string, marketplaceItemId: string) {
    const existing = await prisma.importedItem.findUnique({
      where: {
        organizationId_marketplaceItemId: {
          organizationId,
          marketplaceItemId,
        },
      },
    });

    if (existing) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You have already imported this item',
      });
    }

    try {
      const entitlementService = new EntitlementService(prisma);
      await entitlementService.checkUsageLimit(organizationId, "frameworks");
    } catch (error) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You have reached your framework limit. Please upgrade your plan.',
      });
    }

    const item = await prisma.marketplaceItem.findUnique({
      where: { id: marketplaceItemId },
    });

    if (!item) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Item not found in marketplace',
      });
    }

    if (!item.isPublic && !item.isOfficial) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'This item is not available for import',
      });
    }

    return item;
  }

  /**
   * Import a framework from marketplace into organization.
   */
  static async importFramework(input: ImportFrameworkInput) {
    const { organizationId, marketplaceItemId, frameworkNameOverride, userId } = input;

    // Validate
    const marketplaceItem = await this.validateImport(
      organizationId,
      marketplaceItemId
    );

    if (marketplaceItem.type !== 'FRAMEWORK') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only frameworks can be imported using this method',
      });
    }

    const frameworkMetadata = marketplaceItem.metadata as any;
    if (!frameworkMetadata || !Array.isArray(frameworkMetadata.controls)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid framework structure on the marketplace item',
      });
    }

    const frameworkName =
      frameworkNameOverride || `${marketplaceItem.name} (Imported)`;

    // Create the framework and its controls
    const newFramework = await prisma.framework.create({
      data: {
        name: frameworkName,
        description: marketplaceItem.description,
        organizationId,
        marketplaceSourceId: marketplaceItemId,
        controls: {
          create: frameworkMetadata.controls.map((control: any) => ({
            title: control.title || 'Unnamed Control',
            description: control.description || '',
            domain: control.domain || 'General',
          })),
        },
      },
      include: { controls: true },
    });

    // Record the import
    const importedItem = await prisma.importedItem.create({
      data: {
        organizationId,
        marketplaceItemId,
        itemType: 'FRAMEWORK',
        itemName: marketplaceItem.name,
        itemVersion: marketplaceItem.version,
        importedFrameworkId: newFramework.id,
        sourceMetadata: marketplaceItem.metadata || {},
      },
    });

    // Increment download count
    await prisma.marketplaceItem.update({
      where: { id: marketplaceItemId },
      data: { downloads: { increment: 1 } },
    });

    // Create audit log
    const changes = {
      marketplaceItemId,
      importedItemId: importedItem.id,
      controlCount: newFramework.controls.length,
    };
    
    await prisma.auditLog.create({
      data: {
        action: 'import.framework',
        organizationId,
        userId: userId || null,
        entity: 'Framework',
        entityId: newFramework.id,
        changes,
        currentHash: crypto.createHash('sha256').update(JSON.stringify(changes)).digest('hex'),
      },
    });

    return {
      framework: newFramework,
      importedItem,
      controlCount: newFramework.controls.length,
    };
  }

  /**
   * Get all imported items for an organization.
   */
  static async getImportedItems(organizationId: string) {
    return prisma.importedItem.findMany({
      where: { organizationId },
      include: {
        sourceItem: {
          select: {
            id: true,
            name: true,
            version: true,
            author: { select: { name: true } },
            ratings: true,
          },
        },
      },
      orderBy: { importedAt: 'desc' },
    });
  }

  /**
   * Check if update is available for imported item.
   */
  static async checkForUpdate(importedItemId: string) {
    const imported = await prisma.importedItem.findUnique({
      where: { id: importedItemId },
      include: { sourceItem: true },
    });

    if (!imported) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Imported item not found',
      });
    }

    if (!imported.sourceItem) {
      return { hasUpdate: false };
    }

    const currentVersion = imported.itemVersion;
    const latestVersion = imported.sourceItem.version;

    return {
      hasUpdate: currentVersion !== latestVersion,
      currentVersion,
      latestVersion,
    };
  }

  /**
   * Unimport (remove) a framework.
   */
  static async unimportFramework(
    importedItemId: string,
    organizationId: string,
    userId?: string
  ) {
    const imported = await prisma.importedItem.findUnique({
      where: { id: importedItemId },
    });

    if (!imported) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Imported item not found',
      });
    }

    if (imported.organizationId !== organizationId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to remove this import',
      });
    }

    if (imported.importedFrameworkId) {
      await prisma.framework.delete({
        where: { id: imported.importedFrameworkId },
      });
    }

    await prisma.importedItem.delete({
      where: { id: importedItemId },
    });

    const changes = { importedItemId };
    await prisma.auditLog.create({
      data: {
        action: 'import.removed',
        organizationId,
        userId: userId || null,
        entity: 'ImportedItem',
        entityId: importedItemId,
        changes,
        currentHash: crypto.createHash('sha256').update(JSON.stringify(changes)).digest('hex'),
      },
    });

    return { success: true };
  }
}
