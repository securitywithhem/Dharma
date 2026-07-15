// Phase 8 Part 1 — SCIM ServiceProviderConfig. Okta and Azure AD probe this
// to learn which optional features we support before provisioning.
import { NextRequest } from "next/server";
import { withScimAuth, scimJson, scimBaseUrl } from "@/server/services/scim/handler";

export async function GET(
  request: NextRequest,
  { params }: { params: { orgId: string } },
) {
  return withScimAuth(request, params.orgId, async ({ organizationId }) =>
    scimJson({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri: "https://github.com/dharma/dharma",
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          description: "Authorization: Bearer <token> issued in Dharma enterprise settings.",
        },
      ],
      meta: {
        resourceType: "ServiceProviderConfig",
        location: `${scimBaseUrl(organizationId)}/ServiceProviderConfig`,
      },
    }),
  );
}
