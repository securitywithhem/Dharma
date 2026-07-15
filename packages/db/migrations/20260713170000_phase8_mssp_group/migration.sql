
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "OrganizationGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MsspGrant" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "grantedUserId" TEXT NOT NULL,
    "scopeOrgIds" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MsspGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationGroup_parentOrgId_idx" ON "OrganizationGroup"("parentOrgId");

-- CreateIndex
CREATE INDEX "MsspGrant_grantedUserId_idx" ON "MsspGrant"("grantedUserId");

-- CreateIndex
CREATE INDEX "MsspGrant_groupId_idx" ON "MsspGrant"("groupId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrganizationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MsspGrant" ADD CONSTRAINT "MsspGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrganizationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

