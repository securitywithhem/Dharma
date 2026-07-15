-- CreateEnum
CREATE TYPE "EndpointStatus" AS ENUM ('PENDING', 'ACTIVE', 'STALE', 'REVOKED');


-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "enrollmentTokenHash" TEXT NOT NULL,
    "status" "EndpointStatus" NOT NULL DEFAULT 'PENDING',
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndpointCheck" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "controlId" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EndpointCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_enrollmentTokenHash_key" ON "Endpoint"("enrollmentTokenHash");

-- CreateIndex
CREATE INDEX "Endpoint_organizationId_status_idx" ON "Endpoint"("organizationId", "status");

-- CreateIndex
CREATE INDEX "EndpointCheck_organizationId_checkType_collectedAt_idx" ON "EndpointCheck"("organizationId", "checkType", "collectedAt");

-- CreateIndex
CREATE INDEX "EndpointCheck_endpointId_collectedAt_idx" ON "EndpointCheck"("endpointId", "collectedAt");

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndpointCheck" ADD CONSTRAINT "EndpointCheck_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndpointCheck" ADD CONSTRAINT "EndpointCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndpointCheck" ADD CONSTRAINT "EndpointCheck_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE SET NULL ON UPDATE CASCADE;

