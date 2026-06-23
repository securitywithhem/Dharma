"use client";

import { useEffect, useState } from "react";
import { api } from "@/hooks/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Copy, Check, ExternalLink, ShieldCheck, Clock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function SettingsPage() {
  const organizationQuery = api.settings.organization.useQuery(undefined, {
    retry: false
  });
  const sessionQuery = api.settings.session.useQuery();
  const createAuditorKeyMutation = api.settings.createAuditorKey.useMutation();

  const [duration, setDuration] = useState<"1d" | "7d" | "30d">("1d");
  const [generatedLink, setGeneratedLink] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  const isAdmin = sessionQuery.data?.role === "ADMIN";

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
        <p className="text-muted-foreground">
          Admin-only organization context and session claims exposed through tRPC.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Session context</CardTitle>
              <CardDescription>These values come from the customized NextAuth session callback.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>User ID: {sessionQuery.data?.id ?? "Unavailable"}</p>
              <p>Role: {sessionQuery.data?.role ?? "Unavailable"}</p>
              <p>Organization ID: {sessionQuery.data?.organizationId ?? "Unavailable"}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
              <CardDescription>Counts reflect the currently authenticated organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>Name: {organizationQuery.data?.name ?? "Admin access required"}</p>
              <Separator />
              <div className="grid gap-3 sm:grid-cols-2">
                <p>Users: {organizationQuery.data?._count.users ?? 0}</p>
                <p>Frameworks: {organizationQuery.data?._count.frameworks ?? 0}</p>
                <p>Policies: {organizationQuery.data?._count.policies ?? 0}</p>
                <p>Evidence: {organizationQuery.data?._count.evidences ?? 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-indigo-600 dark:text-amber-500" />
                Auditor Access Portal
              </CardTitle>
              <CardDescription>
                Generate a time-limited, read-only login link for external auditors or compliance regulators.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
              {isAdmin ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Link Duration</label>
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
                    className="w-full bg-indigo-600 hover:bg-indigo-700 dark:bg-amber-600 dark:hover:bg-amber-700"
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
                          className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-xs shadow-sm transition-colors"
                        />
                        <Button size="icon" variant="outline" onClick={handleCopyLink}>
                          {copied ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        This token will automatically expire after {duration === "1d" ? "24 hours" : duration === "7d" ? "7 days" : "30 days"}.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 p-4 rounded-lg text-sm border border-red-100 dark:border-red-950">
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

