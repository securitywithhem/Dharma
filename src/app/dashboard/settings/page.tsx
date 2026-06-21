"use client";

import { api } from "@/hooks/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const organizationQuery = api.settings.organization.useQuery(undefined, {
    retry: false
  });
  const sessionQuery = api.settings.session.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Admin-only organization context and session claims exposed through tRPC.
        </p>
      </div>

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
  );
}
