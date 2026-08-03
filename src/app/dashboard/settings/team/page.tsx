"use client";

// Settings → Team — org member roster. The nav tab for this route already
// existed (settings/layout.tsx) but the route did not, so it 404'd.
// Layout/component vocabulary mirrors the Roles page for consistency.
import React, { useState } from "react";
import { toast } from "sonner";
import { MailPlus, Trash2, Users } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

export default function TeamSettingsPage() {
  const [page, setPage] = useState(1);
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
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const data = membersQuery.data;
  const isBusy = updateRole.isPending || removeMember.isPending;

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
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isBusy || member.status !== "ACTIVE"}
                          aria-label={`Remove ${member.email}`}
                          onClick={() => removeMember.mutate({ userId: member.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
    </div>
  );
}
