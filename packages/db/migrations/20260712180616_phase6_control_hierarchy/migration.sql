-- AlterTable
ALTER TABLE "Control" ADD COLUMN     "code" TEXT,
ADD COLUMN     "depth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "path" JSONB,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Control_parentId_idx" ON "Control"("parentId");

-- CreateIndex
CREATE INDEX "Control_frameworkId_parentId_sortOrder_idx" ON "Control"("frameworkId", "parentId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Control" ADD CONSTRAINT "Control_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GIN index on the materialized `path` JSONB array for O(log n) ancestor/descendant
-- containment lookups (e.g. `path @> '["<ancestorId>"]'`). jsonb_path_ops is smaller
-- and faster than the default jsonb_ops for the pure @> containment queries we use.
-- Not expressible via the Prisma schema, so added as a raw follow-up statement.
CREATE INDEX "Control_path_gin_idx" ON "Control" USING GIN ("path" jsonb_path_ops);
