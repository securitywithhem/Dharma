"use client";

import { ShieldCheck, ShieldX } from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  const sessionQuery = api.settings.session.useQuery();
  const orgQuery = api.settings.organization.useQuery(undefined, {
    retry: false
  });
  const frameworksQuery = api.framework.list.useQuery();
  const evidenceQuery = api.evidence.list.useQuery();
  const auditQuery = api.audit.verifyIntegrity.useQuery();

  const stats = [
    {
      label: "Frameworks",
      value: frameworksQuery.data?.length ?? 0,
      note: "Active compliance frameworks"
    },
    {
      label: "Evidence",
      value: evidenceQuery.data?.items.length ?? 0,
      note: "Artifacts registered in storage"
    },
    {
      label: "Users",
      value: orgQuery.data?._count.users ?? 0,
      note: "Workspace members"
    }
  ];

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Badge variant="success">Authenticated session</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome back{sessionQuery.data?.name ? `, ${sessionQuery.data.name}` : ""}.
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Your foundation layer is live with protected routing, typed APIs, and organization-scoped persistence.
          </p>
        </div>
        <Card className="min-w-[280px] border-primary/10">
          <CardContent className="flex items-center gap-4 p-6">
            {auditQuery.data?.ok ? (
              <ShieldCheck className="h-10 w-10 text-emerald-500" />
            ) : (
              <ShieldX className="h-10 w-10 text-destructive" />
            )}
            <div>
              <p className="font-semibold">Audit chain</p>
              <p className="text-sm text-muted-foreground">
                {auditQuery.data?.ok
                  ? "Integrity verified for the current organization."
                  : auditQuery.data?.reason ?? "Waiting for audit data."}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-4xl">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{stat.note}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
