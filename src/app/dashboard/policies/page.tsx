"use client";

import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function PoliciesPage() {
  const policiesQuery = api.policy.list.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Policies</h1>
        <p className="text-muted-foreground">
          Versioned policy records are organization-scoped and ready for future editing workflows.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {policiesQuery.data?.map((policy) => (
          <Card key={policy.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{policy.title}</CardTitle>
                  <CardDescription>{policy.policyType.replaceAll("_", " ")}</CardDescription>
                </div>
                <Badge variant={policy.isPublished ? "success" : "outline"}>
                  {policy.isPublished ? "Published" : "Draft"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="line-clamp-3 text-sm text-muted-foreground">{policy.content}</p>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Version {policy.version}
              </p>
            </CardContent>
          </Card>
        ))}

        {policiesQuery.data?.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No policies yet</CardTitle>
              <CardDescription>Create them through the `policy.create` router as this layer expands.</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
