// Phase 8 Part 1 — SP metadata for the IdP to consume (App Flow journey 6
// step 3: "Dharma validates, provides callback URL"). Contains only public
// SP-side values (entityID + ACS URL), so it is intentionally unauthenticated
// — IdPs fetch it directly.
import { NextResponse } from "next/server";
import { generateSpMetadata } from "@/server/services/sso/saml.service";

export async function GET(
  _request: Request,
  { params }: { params: { orgId: string } },
) {
  const xml = generateSpMetadata(params.orgId);
  return new NextResponse(xml, {
    headers: { "content-type": "application/samlmetadata+xml" },
  });
}
