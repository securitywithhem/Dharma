-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('CUSTOM_PDF', 'BOARD_SUMMARY');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'GENERATING', 'COMPLETED', 'FAILED');


-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'QUEUED',
    "fileUrl" TEXT,
    "errorMessage" TEXT,
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reportConfig" JSONB NOT NULL,
    "cron" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_organizationId_type_createdAt_idx" ON "Report"("organizationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Report_organizationId_status_idx" ON "Report"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ReportSchedule_organizationId_enabled_idx" ON "ReportSchedule"("organizationId", "enabled");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

