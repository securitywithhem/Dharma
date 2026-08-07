"use client";

/**
 * GH #22 — Settings → Security: the session control posture.
 *
 * Renders what an admin CAN do (org-wide and per-user revocation, and the
 * concrete idle lifetime) rather than only what is absent. The "Not available"
 * card below it on the page still names the one real gap — per-device
 * granularity — so the page reads as a documented posture instead of a
 * disclaimer.
 *
 * Non-admins see the posture, not the buttons: the numbers are useful to
 * anyone answering a security questionnaire, the kill-switch is not.
 */

import React, { useState } from "react";
import { toast } from "sonner";
import { LogOut, ShieldAlert, Timer } from "lucide-react";

import { api } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";

function formatDuration(seconds: number): string {
  const days = seconds / 86_400;
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = seconds / 3_600;
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(seconds / 60)} minutes`;
}

function formatInstant(value: Date | string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionControlCard() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const postureQuery = api.organization.sessionPosture.useQuery();
  const utils = api.useUtils();

  const revokeAll = api.organization.revokeAllSessions.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Signed out ${result.usersAffected} account${result.usersAffected === 1 ? "" : "s"}. ` +
          "You will be asked to sign in again on your next action.",
      );
      setConfirmOpen(false);
      void utils.organization.sessionPosture.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (postureQuery.isLoading) {
    return <Skeleton className="h-48 w-full rounded-lg" />;
  }

  // Same discipline as the SSO page: a failed query must say so, never leave a
  // security-posture card silently blank. A blank card here would read as
  // "no session controls exist", which is now the wrong answer.
  if (postureQuery.isError || !postureQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session control</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-dharma-ink-secondary">
          <p>
            Could not load your organization&apos;s session posture. Session revocation
            is unaffected by this error — it is enforced server-side — but the
            controls cannot be shown until this loads.
          </p>
          <Button variant="outline" size="sm" onClick={() => void postureQuery.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const posture = postureQuery.data;
  // The mutation is permission-gated server-side (`sessions.revoke`); this only
  // decides whether to render a button the user would be refused for pressing.
  const canRevoke = !revokeAll.isError || revokeAll.error?.data?.code !== "FORBIDDEN";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" />
            Session control
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-start gap-2 text-dharma-ink-secondary">
            <Timer className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Sessions expire after{" "}
              <span className="font-medium text-dharma-ink">
                {formatDuration(posture.maxAgeSeconds)} of inactivity
              </span>
              , and an active session&apos;s token is re-issued every{" "}
              {formatDuration(posture.updateAgeSeconds)}.
            </p>
          </div>

          <div className="flex items-start gap-2 text-dharma-ink-secondary">
            <LogOut className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              An administrator can invalidate every session in this organization,
              or every session belonging to one member (Settings → Team → Sign out
              everywhere). Revocation is enforced on the next request each signed-in
              browser makes — not at their next sign-in — and is written to the audit
              log. Last organization-wide or per-user revocation:{" "}
              <span className="font-medium text-dharma-ink">
                {formatInstant(posture.lastRevocationAt)}
              </span>
              .
            </p>
          </div>

          {canRevoke && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={revokeAll.isPending}
            >
              Sign out every member
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out every member of this organization?"
        description={
          <>
            Every signed-in browser and device for every member loses access on its
            next request, and everyone must sign in again.{" "}
            <strong>This includes you</strong> — there is deliberately no exemption
            for the person pressing this, because the session you would be exempting
            is the one an attacker who reached this page would be holding. This is
            written to the audit log.
          </>
        }
        confirmLabel={revokeAll.isPending ? "Revoking…" : "Revoke all sessions"}
        pending={revokeAll.isPending}
        requireTypedConfirmation="REVOKE ALL"
        onConfirm={() => revokeAll.mutate()}
      />
    </>
  );
}
