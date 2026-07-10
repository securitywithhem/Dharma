-- DropForeignKey
ALTER TABLE "EvidenceMapping" DROP CONSTRAINT "EvidenceMapping_connectorId_fkey";

-- DropForeignKey
ALTER TABLE "EvidenceMapping" DROP CONSTRAINT "EvidenceMapping_controlId_fkey";

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "evidenceMappingId" TEXT;

-- CreateIndex
CREATE INDEX "Evidence_evidenceMappingId_idx" ON "Evidence"("evidenceMappingId");

-- CreateIndex
CREATE INDEX "EvidenceMapping_connectorId_idx" ON "EvidenceMapping"("connectorId");

-- CreateIndex
CREATE INDEX "EvidenceMapping_controlId_idx" ON "EvidenceMapping"("controlId");

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_evidenceMappingId_fkey" FOREIGN KEY ("evidenceMappingId") REFERENCES "EvidenceMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceMapping" ADD CONSTRAINT "EvidenceMapping_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceMapping" ADD CONSTRAINT "EvidenceMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

