"use client";

// Phase 9 Part 1 — endpoint list (4_UI_UX_DESIGN.md "Cloud Connectors" card
// pattern reused: card grid, status badge with pulsating dot, wizard-style
// enroll modal). Path is src/app/dashboard/endpoints/ — this repo has no
// (dashboard) route group.
import React, { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Copy, MonitorSmartphone, ShieldOff, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EndpointStatusDot } from "@/components/endpoints/EndpointStatusDot";

export default function EndpointsPage() {
  const utils = api.useUtils();
  const listQuery = api.endpoint.list.useQuery({ limit: 50 });

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [form, setForm] = useState({ hostname: "", os: "macOS", osVersion: "" });
  const [enrolled, setEnrolled] = useState<{ token: string; command: string } | null>(null);

  const enroll = api.endpoint.enroll.useMutation({
    onSuccess: (result) => {
      setEnrolled({ token: result.enrollmentToken, command: result.installCommand });
      void utils.endpoint.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = api.endpoint.revoke.useMutation({
    onSuccess: () => {
      toast.success("Endpoint revoked — future heartbeats will be rejected");
      void utils.endpoint.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const closeEnroll = () => {
    setEnrollOpen(false);
    setEnrolled(null);
    setForm({ hostname: "", os: "macOS", osVersion: "" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Endpoints</h1>
          <p className="text-sm text-muted-foreground">
            Continuous compliance monitoring agents on your devices (EDR-lite).
          </p>
        </div>
        <Button onClick={() => setEnrollOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Enroll endpoint
        </Button>
      </div>

      {listQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-lg" />
          ))}
        </div>
      ) : (listQuery.data?.items ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <MonitorSmartphone className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No endpoints enrolled</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Enroll a device to start collecting disk-encryption, patch-level, screen-lock,
              and firewall posture checks that map to your controls.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(listQuery.data?.items ?? []).map((endpoint) => (
            <Card
              key={endpoint.id}
              data-testid={`endpoint-card-${endpoint.id}`}
              className="transition-colors hover:border-primary/50"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
                    {endpoint.hostname}
                  </CardTitle>
                  <EndpointStatusDot status={endpoint.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  {endpoint.os} {endpoint.osVersion} · agent {endpoint.agentVersion}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {endpoint._count.checks} checks ·{" "}
                    {endpoint.lastHeartbeatAt
                      ? `last seen ${new Date(endpoint.lastHeartbeatAt).toLocaleString()}`
                      : "never seen"}
                  </span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="outline" size="sm">
                    <Link href={`/dashboard/endpoints/${endpoint.id}` as never}>
                      View checks
                    </Link>
                  </Button>
                  {endpoint.status !== "REVOKED" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate({ id: endpoint.id })}
                    >
                      <ShieldOff className="mr-1 h-3 w-3" /> Revoke
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Enroll wizard modal — mirrors the Cloud Connectors config wizard. */}
      <Dialog open={enrollOpen} onOpenChange={(open) => (open ? setEnrollOpen(true) : closeEnroll())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll a new endpoint</DialogTitle>
            <DialogDescription>
              {enrolled
                ? "Run this one-line installer on the device. The token is shown only once."
                : "Register the device, then run the generated install command on it."}
            </DialogDescription>
          </DialogHeader>

          {!enrolled ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="hostname">Hostname</Label>
                <Input
                  id="hostname"
                  placeholder="laptop-alice"
                  value={form.hostname}
                  onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="os">OS</Label>
                  <Input
                    id="os"
                    value={form.os}
                    onChange={(e) => setForm({ ...form, os: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="osVersion">OS version</Label>
                  <Input
                    id="osVersion"
                    placeholder="14.5"
                    value={form.osVersion}
                    onChange={(e) => setForm({ ...form, osVersion: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="mb-2 flex items-center gap-2 text-xs font-medium">
                  <CheckCircle2 className="h-3 w-3" /> Copy this now — it is shown only once.
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={enrolled.command} className="font-mono text-[11px]" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      void navigator.clipboard.writeText(enrolled.command);
                      toast.success("Install command copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {!enrolled ? (
              <>
                <Button variant="outline" onClick={closeEnroll}>
                  Cancel
                </Button>
                <Button
                  disabled={!form.hostname.trim() || !form.osVersion.trim() || enroll.isPending}
                  onClick={() => enroll.mutate(form)}
                >
                  Generate install command
                </Button>
              </>
            ) : (
              <Button onClick={closeEnroll}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
