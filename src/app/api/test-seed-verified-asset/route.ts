import { NextRequest, NextResponse } from "next/server";
import { assertTestRoutesEnabled } from "@/server/testRoutes";
import { prisma } from "@/server/db";

/**
 * Test-only backdoor (same deny-by-default gating as /api/test-auth): marks a
 * domain as an ownership-verified asset for the logged-in org.
 *
 * WAVE 0.1 gates every scan on a VerifiedAsset whose DNS TXT challenge the
 * server resolved itself. That challenge cannot be satisfied from CI — it
 * needs a real DNS zone the test controls, which this environment does not
 * have. So the E2E suite proves the two halves separately:
 *
 *   - the DNS challenge logic (token issue, TXT match, chunk rejoin, wrong
 *     token, NXDOMAIN) is unit-tested against an injected resolver in
 *     tests/assetVerification.test.ts;
 *   - everything downstream of a verified asset — that a scan is accepted,
 *     and refused the moment the asset is revoked — is E2E-tested using this
 *     route to establish the verified state.
 *
 * Writing the row directly rather than stubbing DNS keeps the production
 * verification path free of any test-only branch. There is deliberately no
 * way to reach this from the application itself.
 */
export async function GET(req: NextRequest) {
  const blocked = assertTestRoutesEnabled();
  if (blocked) return blocked;

  const email = req.nextUrl.searchParams.get("email") ?? "admin@dharma.local";
  const domain = req.nextUrl.searchParams.get("domain");

  if (!domain) {
    return NextResponse.json({ error: "domain query param is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "User not found — call /api/test-auth first" },
      { status: 400 },
    );
  }

  const asset = await prisma.verifiedAsset.upsert({
    where: {
      organizationId_value: { organizationId: user.organizationId, value: domain.toLowerCase() },
    },
    update: { verifiedAt: new Date(), verifiedById: user.id, revokedAt: null },
    create: {
      organizationId: user.organizationId,
      value: domain.toLowerCase(),
      kind: "DOMAIN",
      method: "DNS_TXT",
      verificationToken: "e2e-seeded-token",
      verifiedAt: new Date(),
      verifiedById: user.id,
      requestedById: user.id,
    },
  });

  return NextResponse.json({ assetId: asset.id, value: asset.value });
}
