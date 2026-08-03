import { NextRequest, NextResponse } from "next/server";
import { assertTestRoutesEnabled } from "@/server/testRoutes";
import { prisma } from "@/server/db";

/**
 * Test-only backdoor (same gating as /api/test-auth): seeds a MarketplaceItem
 * + FrameworkVersion + UNREAD RegulatoryAlert for the logged-in org, so E2E
 * tests can exercise the regulatory-alerts UI (diff viewer, acknowledge,
 * dismiss) without running the real regulatory-poller worker or publishing a
 * real marketplace framework version — mirrors test-seed-pentest's approach
 * of seeding directly past async infrastructure the test doesn't need to
 * exercise.
 */
export async function GET(req: NextRequest) {
  const blocked = assertTestRoutesEnabled();
  if (blocked) return blocked;


  const email = req.nextUrl.searchParams.get("email") ?? "admin@dharma.local";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "User not found — call /api/test-auth first" }, { status: 400 });
  }

  const slug = `e2e-seed-framework-${Date.now()}`;
  const item = await prisma.marketplaceItem.create({
    data: {
      type: "FRAMEWORK",
      name: "E2E Seed Framework",
      slug,
      description: "Seeded for regulatory-alerts E2E coverage.",
      authorId: user.id,
      metadata: {},
      category: "compliance",
      tags: [],
      isPublic: true,
    },
  });

  const version = await prisma.frameworkVersion.create({
    data: {
      marketplaceItemId: item.id,
      version: "2.0.0",
      changelog: "Added two new access-control requirements.",
      controlsSnapshot: {},
    },
  });

  const alert = await prisma.regulatoryAlert.create({
    data: {
      organizationId: user.organizationId,
      frameworkVersionId: version.id,
      diffSummary: {
        added: [{ key: "AC-9", title: "Session lock after inactivity" }],
        removed: [],
        modified: [{ key: "AC-2", title: "Account management", changedFields: ["description"] }],
      },
      status: "UNREAD",
    },
  });

  return NextResponse.json({ alertId: alert.id, frameworkVersionId: version.id });
}
