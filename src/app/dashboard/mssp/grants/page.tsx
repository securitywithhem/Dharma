"use client";

// Phase 8 Part 3 — MSSP grant management. Not in UI_UX.md (flagged as an
// addition): required to operate the MsspGrant safety model — explicit
// scoped, expirable, revocable cross-tenant access.
import React, { useState } from "react";
import { toast } from "sonner";
import { Plus, ShieldOff } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function MsspGrantsPage() {
  const utils = api.useUtils();
  const groupsQuery = api.mssp.listGroups.useQuery();

  const [newGroupName, setNewGroupName] = useState("");
  const [grantDraft, setGrantDraft] = useState<{
    groupId: string;
    grantedUserId: string;
    scopeOrgIds: Record<string, boolean>;
    expiresAt: string;
  } | null>(null);

  const invalidate = () => void utils.mssp.listGroups.invalidate();
  const createGroup = api.mssp.createGroup.useMutation({
    onSuccess: () => {
      toast.success("Group created");
      setNewGroupName("");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const createGrant = api.mssp.createGrant.useMutation({
    onSuccess: () => {
      toast.success("Grant created");
      setGrantDraft(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const revokeGrant = api.mssp.revokeGrant.useMutation({
    onSuccess: () => {
      toast.success("Grant revoked — access is blocked immediately");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (groupsQuery.isLoading) return <Skeleton className="h-96 w-full rounded-lg" />;
  const groups = groupsQuery.data ?? [];
  const draftGroup = groups.find((g) => g.id === grantDraft?.groupId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">MSSP access grants</h1>
        <p className="text-sm text-dharma-ink-secondary">
          Cross-tenant access is always explicit: scoped to listed client orgs, optionally
          time-boxed, revocable instantly, and audited on every use.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client groups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="New group name (e.g. Retail Clients)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="max-w-xs"
            />
            <Button
              onClick={() => createGroup.mutate({ name: newGroupName })}
              disabled={newGroupName.trim().length < 2 || createGroup.isPending}
            >
              <Plus className="mr-2 h-4 w-4" /> Create group
            </Button>
          </div>

          {groups.map((group) => (
            <Card key={group.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm">{group.name}</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={group.organizations.length === 0}
                  onClick={() =>
                    setGrantDraft({
                      groupId: group.id,
                      grantedUserId: "",
                      scopeOrgIds: {},
                      expiresAt: "",
                    })
                  }
                >
                  <Plus className="mr-1 h-3 w-3" /> New grant
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-dharma-ink-secondary">
                  {group.organizations.length} client org(s):{" "}
                  {group.organizations.map((o) => o.name).join(", ") || "none attached yet"}
                </p>
                {group.grants.length > 0 && (
                  <div className="space-y-2">
                    {group.grants.map((grant) => (
                      <div
                        key={grant.id}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="text-xs">
                          <span className="font-mono">{grant.grantedUserId}</span>{" "}
                          <Badge variant="secondary" className="ml-2">
                            {grant.scopeOrgIds.length} org(s)
                          </Badge>
                          {grant.expiresAt && (
                            <span className="ml-2 text-dharma-ink-secondary">
                              expires {new Date(grant.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revokeGrant.isPending}
                          onClick={() => revokeGrant.mutate({ grantId: grant.id })}
                        >
                          <ShieldOff className="mr-1 h-3 w-3" /> Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <Dialog open={grantDraft !== null} onOpenChange={(open) => !open && setGrantDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New access grant</DialogTitle>
          </DialogHeader>
          {grantDraft && draftGroup && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="grantee">Grantee user ID (member of your org)</Label>
                <Input
                  id="grantee"
                  value={grantDraft.grantedUserId}
                  onChange={(e) =>
                    setGrantDraft({ ...grantDraft, grantedUserId: e.target.value })
                  }
                  placeholder="usr_..."
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label>Client orgs this grant covers (explicit allow-list)</Label>
                <div className="space-y-1">
                  {draftGroup.organizations.map((org) => (
                    <label key={org.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={grantDraft.scopeOrgIds[org.id] === true}
                        onCheckedChange={(checked) =>
                          setGrantDraft({
                            ...grantDraft,
                            scopeOrgIds: {
                              ...grantDraft.scopeOrgIds,
                              [org.id]: checked === true,
                            },
                          })
                        }
                      />
                      {org.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="expires">Expires (optional)</Label>
                <Input
                  id="expires"
                  type="date"
                  value={grantDraft.expiresAt}
                  onChange={(e) =>
                    setGrantDraft({ ...grantDraft, expiresAt: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                !grantDraft?.grantedUserId ||
                !Object.values(grantDraft?.scopeOrgIds ?? {}).some(Boolean) ||
                createGrant.isPending
              }
              onClick={() => {
                if (!grantDraft) return;
                createGrant.mutate({
                  groupId: grantDraft.groupId,
                  grantedUserId: grantDraft.grantedUserId,
                  scopeOrgIds: Object.entries(grantDraft.scopeOrgIds)
                    .filter(([, on]) => on)
                    .map(([id]) => id),
                  expiresAt: grantDraft.expiresAt
                    ? new Date(`${grantDraft.expiresAt}T23:59:59`)
                    : undefined,
                });
              }}
            >
              Create grant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
