"use client";

// Settings → Security — the signed-in user's own account security.
// Distinct from Settings → SSO & SCIM, which configures org-wide identity.
//
// This page deliberately does NOT show an "active sessions" table or an MFA
// toggle: see src/server/routers/user.ts for why neither has a backing store
// under the current JWT session strategy. The gaps are stated in the UI
// rather than filled with placeholder data.
import React from "react";
import { Info, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  email: "Email link",
};

function formatDateTime(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SecuritySettingsPage() {
  const { data, isLoading, isError, error } = api.user.securityOverview.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-dharma-ink">Security</h1>
        <p className="mt-1 text-sm text-dharma-ink-secondary">
          How you sign in to Dharma. Organization-wide identity settings live under SSO &amp; SCIM.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-dharma-danger-text">{error.message}</p>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" />
                Account
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-dharma-ink-secondary">Email</dt>
                  <dd className="mt-1 text-sm text-dharma-ink">{data.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-dharma-ink-secondary">Email verified</dt>
                  <dd className="mt-1 text-sm">
                    {data.emailVerified ? (
                      <Badge variant="success">Verified</Badge>
                    ) : (
                      <Badge variant="secondary">Not verified</Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-dharma-ink-secondary">Role</dt>
                  <dd className="mt-1 text-sm text-dharma-ink">{data.role}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-dharma-ink-secondary">Member since</dt>
                  <dd className="mt-1 text-sm text-dharma-ink">
                    {formatDateTime(data.accountCreatedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-dharma-ink-secondary">
                    Current session expires
                  </dt>
                  <dd className="mt-1 text-sm text-dharma-ink">
                    {formatDateTime(data.sessionExpires)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-dharma-ink-secondary">
                    SSO enforced for this org
                  </dt>
                  <dd className="mt-1 text-sm">
                    {data.ssoEnforced ? (
                      <Badge variant="success">Enforced</Badge>
                    ) : (
                      <Badge variant="secondary">Not enforced</Badge>
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                Sign-in methods
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.signInMethods.length > 0 ? (
                data.signInMethods.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between rounded-md border border-dharma-border px-4 py-3"
                  >
                    <span className="text-sm font-medium text-dharma-ink">
                      {PROVIDER_LABELS[account.provider] ?? account.provider}
                    </span>
                    <Badge variant="outline">{account.type}</Badge>
                  </div>
                ))
              ) : null}

              {data.emailLinkEnabled && (
                <div className="flex items-center justify-between rounded-md border border-dharma-border px-4 py-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-dharma-ink">
                    <Mail className="h-4 w-4" />
                    Email sign-in link
                  </span>
                  <Badge variant="outline">passwordless</Badge>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="h-4 w-4" />
                Not available on this deployment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-dharma-ink-secondary">
                <li>
                  <span className="font-medium text-dharma-ink">Active session list &amp; remote sign-out</span>{" "}
                  — sessions are stateless JWTs, so the server holds no record of
                  individual devices to display or revoke.
                </li>
                <li>
                  <span className="font-medium text-dharma-ink">Multi-factor authentication</span>{" "}
                  — not implemented in Dharma. Enforce MFA at your identity
                  provider (Google, or your SAML/OIDC IdP via SSO &amp; SCIM).
                </li>
                <li>
                  <span className="font-medium text-dharma-ink">Password change</span>{" "}
                  — this deployment has no password login; access is via Google
                  or an emailed sign-in link.
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
