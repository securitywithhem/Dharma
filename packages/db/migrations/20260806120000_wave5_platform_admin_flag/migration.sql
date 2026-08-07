-- WAVE 5.2 — separate platform authority from tenant role.
--
-- marketplace.approveItem gated on `role = 'ADMIN'`, which is the caller's
-- role within their OWN organization. That let any customer's org admin
-- approve any other tenant's submission into the shared catalogue. Platform
-- administration needs its own field; see the comment on User.isPlatformAdmin
-- in schema.prisma for why this is not a Role value and not an MsspGrant.
--
-- Defaults to false for every existing row, so this migration grants nothing.
-- The first platform admin is designated out of band by the deployment
-- operator, deliberately — no application code path sets this column.
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- No index: the only access path is findUnique by id (sessionIdentity.ts reads
-- the flag off the row it already fetched), so an index would be write cost for
-- no read benefit.
