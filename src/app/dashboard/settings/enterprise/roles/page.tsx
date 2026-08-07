"use client";

// Phase 8 Part 1 — custom-role management: role list table + create/edit
// modal with a permission-checkbox matrix grouped by resource
// (UI_UX doc "Enterprise Settings" / RBAC screens).
import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Lock } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RoleDraft = {
  id?: string;
  name: string;
  permissions: Record<string, boolean>;
};

function groupPermissionKeys(keys: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const key of keys) {
    const resource = key.split(".")[0] ?? "other";
    (groups[resource] ??= []).push(key);
  }
  return groups;
}

export default function RolesSettingsPage() {
  // GH #24 — pending target of the delete confirmation.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const utils = api.useUtils();

  const rolesQuery = api.roles.list.useQuery();
  const keysQuery = api.roles.permissionKeys.useQuery();

  const invalidate = () => void utils.roles.list.invalidate();
  const createRole = api.roles.create.useMutation({
    onSuccess: () => {
      toast.success("Role created");
      setDraft(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const updateRole = api.roles.update.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      setDraft(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteRole = api.roles.delete.useMutation({
    onSuccess: () => {
      toast.success("Role deleted");
      setPendingDelete(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const groups = useMemo(
    () => groupPermissionKeys(keysQuery.data ?? []),
    [keysQuery.data],
  );

  if (rolesQuery.isLoading) {
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }

  const roles = rolesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Roles & permissions</h1>
          <p className="text-sm text-dharma-ink-secondary">
            Built-in roles mirror the legacy access levels; custom roles get an explicit
            permission set.
          </p>
        </div>
        <Button onClick={() => setDraft({ name: "", permissions: {} })}>
          <Plus className="mr-2 h-4 w-4" /> Create role
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Permissions granted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => {
                const grantedCount = Object.values(
                  (role.permissions ?? {}) as Record<string, boolean>,
                ).filter(Boolean).length;
                return (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell>
                      {role.isDefault ? (
                        <Badge variant="secondary">
                          <Lock className="mr-1 h-3 w-3" /> Built-in
                        </Badge>
                      ) : (
                        <Badge>Custom</Badge>
                      )}
                    </TableCell>
                    {/* Effective membership (explicit assignments + members
                        still on the matching legacy enum), not just explicit
                        assignments — see roles.list for why. The delete guard
                        below deliberately still uses _count.users: only an
                        explicit assignment blocks deleting a custom role. */}
                    <TableCell>{role.memberCount}</TableCell>
                    <TableCell>{grantedCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={role.isDefault}
                          onClick={() =>
                            setDraft({
                              id: role.id,
                              name: role.name,
                              permissions: {
                                ...((role.permissions ?? {}) as Record<string, boolean>),
                              },
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={role.isDefault || deleteRole.isPending}
                          aria-label={`Delete role ${role.name}`}
                          // GH #24 — this deleted on the first click. The
                          // members-assigned guard below stays where it is: it
                          // is a precondition, not a confirmation, and telling
                          // someone "reassign members first" is more useful
                          // before they read a consequence they cannot act on.
                          onClick={() => {
                            if (role._count.users > 0) {
                              toast.error(
                                "Reassign this role's members first (see member management).",
                              );
                              return;
                            }
                            setPendingDelete({ id: role.id, name: role.name });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit role" : "Create role"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="role-name">Role name</Label>
                <Input
                  id="role-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Evidence Reviewer"
                />
              </div>
              <div className="max-h-80 space-y-4 overflow-y-auto pr-2">
                {Object.entries(groups).map(([resource, keys]) => (
                  <div key={resource}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-dharma-ink-secondary">
                      {resource}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {keys.map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={draft.permissions[key] === true}
                            onCheckedChange={(checked) =>
                              setDraft({
                                ...draft,
                                permissions: {
                                  ...draft.permissions,
                                  [key]: checked === true,
                                },
                              })
                            }
                          />
                          <span className="font-mono text-xs">{key}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={!draft?.name.trim() || createRole.isPending || updateRole.isPending}
              onClick={() => {
                if (!draft) return;
                if (draft.id) {
                  updateRole.mutate({
                    id: draft.id,
                    name: draft.name,
                    permissions: draft.permissions,
                  });
                } else {
                  createRole.mutate({ name: draft.name, permissions: draft.permissions });
                }
              }}
            >
              {draft?.id ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete this custom role?"
        description={
          <>
            <span className="font-medium">{pendingDelete?.name}</span> and its
            permission matrix are removed permanently. Only roles with no members
            assigned can be deleted, so nobody loses access as a result — but the
            permission set itself is not recoverable and would have to be rebuilt
            checkbox by checkbox. This is written to the audit log.
          </>
        }
        confirmLabel={deleteRole.isPending ? "Deleting…" : "Delete role"}
        pending={deleteRole.isPending}
        onConfirm={() => pendingDelete && deleteRole.mutate({ id: pendingDelete.id })}
      />
    </div>
  );
}
