"use client";

// Settings → Team — org member roster. The nav tab for this route already
// existed (settings/layout.tsx) but the route did not, so it 404'd.
// Layout/component vocabulary mirrors the Roles page for consistency.
import React, { useState } from "react";
import { toast } from "sonner";
import { LogOut, MailPlus, Trash2, Users } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "COMPLIANCE_MANAGER", label: "Compliance Manager" },
  { value: "PUBLISHER", label: "Publisher" },
  { value: "VIEWER", label: "Viewer" },
] as const;

function roleLabel(role: string) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type MemberRef = { id: string; email: string };

export default function TeamSettingsPage() {
  const [page, setPage] = useState(1);
  // One dialog instance per action serves the whole table — the pending member
  // is state, not a dialog rendered per row (see ConfirmDialog's header).
  const [pendingRemove, setPendingRemove] = useState<MemberRef | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<MemberRef | null>(null);
  const utils = api.useUtils();

  const membersQuery = api.organization.listMembers.useQuery({ page, limit: 25 });

  const invalidate = () => void utils.organization.listMembers.invalidate();

  const updateRole = api.organization.updateMemberRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const removeMember = api.organization.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      setPendingRemove(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const revokeUserSessions = api.organization.revokeUserSessions.useMutation({
    onSuccess: () => {
      toast.success("Signed out of every device");
      setPendingRevoke(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const data = membersQuery.data;
  const isBusy =
    updateRole.isPending || removeMember.isPending || revokeUserSessions.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-dharma-ink">Team</h1>
        <p className="mt-1 text-sm text-dharma-ink-secondary">
          People with access to this organization. Roles determine what each member can see and change.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Members
            {data ? (
              <Badge variant="secondary">{data.total}</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          )}

          {membersQuery.isError && (
            <p className="py-8 text-center text-sm text-dharma-danger-text">
              {membersQuery.error.message}
            </p>
          )}

          {data && data.members.length === 0 && (
            <p className="py-8 text-center text-sm text-dharma-ink-secondary">
              No members yet.
            </p>
          )}

          {data && data.members.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    {/* No lastLoginAt column exists in this schema, so we show
                        join date rather than fabricating activity data. */}
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        {member.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-dharma-ink-secondary">
                        {member.email}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={member.role}
                          onValueChange={(role) =>
                            updateRole.mutate({ userId: member.id, role: role as typeof ROLE_OPTIONS[number]["value"] })
                          }
                        >
                          {/* Select itself takes no `disabled`; the trigger is
                              the button, so it carries it. */}
                          <SelectTrigger
                            className="w-[180px]"
                            disabled={isBusy}
                            aria-label={`Role for ${member.email}`}
                          >
                            <SelectValue placeholder={roleLabel(member.role)} />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={member.status === "ACTIVE" ? "success" : "secondary"}
                        >
                          {member.status === "ACTIVE" ? "Active" : "Deactivated"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-dharma-ink-secondary">
                        {formatDate(member.joinedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* GH #22 — the per-user offboarding kill-switch.
                              Separate from removal on purpose: "sign this
                              person out of everything" is the stolen-laptop
                              response and must not also deactivate an
                              employee who still works here. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isBusy || member.status !== "ACTIVE"}
                            aria-label={`Sign ${member.email} out of all sessions`}
                            title="Sign out everywhere"
                            onClick={() =>
                              setPendingRevoke({ id: member.id, email: member.email })
                            }
                          >
                            <LogOut className="h-4 w-4" />
                          </Button>
                          {/* GH #24 — this used to delete straight from the
                              click. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isBusy || member.status !== "ACTIVE"}
                            aria-label={`Remove ${member.email}`}
                            onClick={() =>
                              setPendingRemove({ id: member.id, email: member.email })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data && data.pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-dharma-ink-secondary">
                Page {data.page} of {data.pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MailPlus className="h-4 w-4" />
              Pending invites
              <Badge variant="secondary">{data.pendingInvites.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Invited</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pendingInvites.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell>{roleLabel(invite.role)}</TableCell>
                      <TableCell className="text-dharma-ink-secondary">
                        {formatDate(invite.createdAt)}
                      </TableCell>
                      <TableCell className="text-dharma-ink-secondary">
                        {formatDate(invite.expiresAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title="Remove this member?"
        description={
          <>
            <span className="font-medium">{pendingRemove?.email}</span> loses access
            immediately and every one of their signed-in devices is cut off on its
            next request. Their account row is retained, not deleted, so audit-log
            entries and evidence they uploaded stay attributed to them. This is
            written to the audit log.
          </>
        }
        confirmLabel={removeMember.isPending ? "Removing…" : "Remove member"}
        pending={removeMember.isPending}
        onConfirm={() =>
          pendingRemove && removeMember.mutate({ userId: pendingRemove.id })
        }
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
        title="Sign this member out everywhere?"
        description={
          <>
            Every signed-in browser and device belonging to{" "}
            <span className="font-medium">{pendingRevoke?.email}</span> loses access
            on its next request. Their account stays active — they can sign back in.
            Use this for a lost device or a suspected credential compromise. This is
            written to the audit log.
          </>
        }
        confirmLabel={revokeUserSessions.isPending ? "Signing out…" : "Sign out everywhere"}
        pending={revokeUserSessions.isPending}
        onConfirm={() =>
          pendingRevoke && revokeUserSessions.mutate({ userId: pendingRevoke.id })
        }
      />
    </div>
  );
}
