"use client";

import { useEffect, useState } from "react";
import { api } from "@/hooks/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Copy, Check, ExternalLink, ShieldCheck, Clock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Render one read-only field across all three query states.
 *
 * Every field on this page used to be written as `data?.x ?? <fallback>`, which
 * silently conflates "still loading" with "no value" — so while the queries
 * were in flight the page asserted things that were not true: identifiers read
 * "Unavailable", counts read 0, and the organization name read "Admin access
 * required", accusing an admin of lacking access. Loading must render a
 * skeleton, and only a settled query may render a negative statement.
 */
function Field({
  label,
  value,
  isPending,
  isError,
  errorText = "Unavailable",
}: {
  label: string;
  value: React.ReactNode;
  isPending: boolean;
  isError: boolean;
  errorText?: string;
}) {
  return (
    <p className="flex items-center gap-2">
      <span>{label}:</span>
      {isPending ? (
        <Skeleton className="h-4 w-40" />
      ) : isError ? (
        <span className="text-dharma-ink-secondary">{errorText}</span>
      ) : (
        <span>{value}</span>
      )}
    </p>
  );
}

export default function SettingsPage() {
  const organizationQuery = api.settings.organization.useQuery(undefined, {
    retry: false
  });
  const sessionQuery = api.settings.session.useQuery();
  const createAuditorKeyMutation = api.settings.createAuditorKey.useMutation();

  const [duration, setDuration] = useState<"1d" | "7d" | "30d">("1d");
  const [generatedLink, setGeneratedLink] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  const sessionPending = sessionQuery.isPending;
  const orgPending = organizationQuery.isPending;
  // Only a settled session can tell us the caller is NOT an admin. While the
  // query is in flight `isAdmin` is false, which is why the red "you must hold
  // the ADMIN role" panel used to flash on every load.
  const isAdmin = sessionQuery.isSuccess && sessionQuery.data?.role === "ADMIN";

  const handleGenerateKey = async () => {
    try {
      const result = await createAuditorKeyMutation.mutateAsync({ duration });
      // Build absolute URL
      const appUrl = window.location.origin;
      setGeneratedLink(`${appUrl}${result.url}`);
      setCopied(false);
    } catch (error) {
      console.error("Failed to generate auditor link", error);
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-dharma-ink-secondary">
          Manage your workspace, team access, and auditor sharing.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workspace session</CardTitle>
              <CardDescription>These values describe the signed-in workspace member.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Field
                label="User ID"
                value={sessionQuery.data?.id}
                isPending={sessionPending}
                isError={sessionQuery.isError}
              />
              <Field
                label="Role"
                value={sessionQuery.data?.role}
                isPending={sessionPending}
                isError={sessionQuery.isError}
              />
              <Field
                label="Organization ID"
                value={sessionQuery.data?.organizationId}
                isPending={sessionPending}
                isError={sessionQuery.isError}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>Counts reflect the currently authenticated organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* `settings.organization` is admin-only and set to retry:false, so a
                  rejection here genuinely does mean insufficient access — but only
                  once the query has actually failed, never while it is pending. */}
              <Field
                label="Name"
                value={organizationQuery.data?.name}
                isPending={orgPending}
                isError={organizationQuery.isError}
                errorText="Admin access required"
              />
              <Separator />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Users"
                  value={organizationQuery.data?._count.users}
                  isPending={orgPending}
                  isError={organizationQuery.isError}
                  errorText="—"
                />
                <Field
                  label="Frameworks"
                  value={organizationQuery.data?._count.frameworks}
                  isPending={orgPending}
                  isError={organizationQuery.isError}
                  errorText="—"
                />
                <Field
                  label="Policies"
                  value={organizationQuery.data?._count.policies}
                  isPending={orgPending}
                  isError={organizationQuery.isError}
                  errorText="—"
                />
                <Field
                  label="Evidence"
                  value={organizationQuery.data?._count.evidences}
                  isPending={orgPending}
                  isError={organizationQuery.isError}
                  errorText="—"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-dharma-accent-on-tint" />
                Share with Auditor
              </CardTitle>
              <CardDescription>
                Generate a time-limited, read-only link for external auditors or compliance reviewers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
              {isAdmin ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Link duration</label>
                    <Select
                      value={duration}
                      onValueChange={(val) => setDuration(val as "1d" | "7d" | "30d")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1d">1 Day (Recommended)</SelectItem>
                        <SelectItem value="7d">7 Days</SelectItem>
                        <SelectItem value="30d">30 Days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={handleGenerateKey}
                    disabled={createAuditorKeyMutation.isPending}
                    className="w-full bg-dharma-accent hover:bg-dharma-accent-hover"
                  >
                    {createAuditorKeyMutation.isPending ? "Generating..." : "Generate Auditor Link"}
                  </Button>

                  {generatedLink && (
                    <div className="space-y-2 pt-4">
                      <label className="text-sm font-medium">Auditor Access Link</label>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          type="text"
                          value={generatedLink}
                          className="flex h-9 w-full rounded-md border border-dharma-border-strong bg-dharma-surface-hover px-3 py-1 text-xs border border-dharma-border transition-colors"
                        />
                        <Button size="icon" variant="outline" onClick={handleCopyLink}>
                          {copied ? (
                            <Check className="h-4 w-4 text-dharma-success-text" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-dharma-ink-secondary flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        This link will automatically expire after {duration === "1d" ? "24 hours" : duration === "7d" ? "7 days" : "30 days"}.
                      </p>
                    </div>
                  )}
                </div>
              ) : sessionPending ? (
                <div className="space-y-3">
                  <Skeleton className="h-9 w-full rounded-md" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ) : (
                <div className="bg-dharma-danger-bg text-dharma-danger-text p-4 rounded-lg text-sm border border-dharma-danger">
                  You must hold the <strong>ADMIN</strong> role to generate external auditor keys. Please contact your administrator.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
