"use client";

// Phase 9 Part 3 — API key management. Create/list/revoke keys with scope
// checkboxes; the plaintext key is shown exactly once at creation (never
// again), matching the Part 1 endpoint-enrollment-token pattern. Links to the
// generated OpenAPI spec.
import React, { useState } from "react";
import { toast } from "sonner";
import { Plus, Copy, Trash2, Code2, KeyRound, CheckCircle2, ExternalLink } from "lucide-react";
import { api } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ApiKeysPage() {
  const utils = api.useUtils();
  const listQuery = api.apiKey.list.useQuery();
  const scopesQuery = api.apiKey.scopes.useQuery();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Record<string, boolean>>({});
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  // GH #24 — pending target of the revoke confirmation.
  const [pendingRevoke, setPendingRevoke] = useState<{ id: string; name: string } | null>(null);

  const create = api.apiKey.create.useMutation({
    onSuccess: (res) => {
      setCreatedToken(res.token);
      void utils.apiKey.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = api.apiKey.revoke.useMutation({
    onSuccess: () => {
      toast.success("API key revoked");
      setPendingRevoke(null);
      void utils.apiKey.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const close = () => {
    setOpen(false);
    setCreatedToken(null);
    setName("");
    setScopes({});
  };

  if (listQuery.isLoading) return <Skeleton className="h-96 w-full rounded-lg" />;
  const keys = listQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API keys</h1>
          <p className="text-sm text-dharma-ink-secondary">
            Programmatic access to your compliance data for third-party integrations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/v1/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-dharma-surface-hover"
          >
            <Code2 className="mr-2 h-4 w-4" /> OpenAPI spec
            <ExternalLink className="ml-1 h-3 w-3" />
          </a>
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Create key
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <KeyRound className="h-7 w-7 text-dharma-ink-secondary" />
              <p className="text-sm text-dharma-ink-secondary">No API keys yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => {
                const scopeList = Array.isArray(k.scopes) ? (k.scopes as string[]) : [];
                const revoked = Boolean(k.revokedAt);
                return (
                  <div
                    key={k.id}
                    data-testid={`api-key-row-${k.id}`}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{k.name}</span>
                        <code className="rounded bg-dharma-surface-hover px-1.5 py-0.5 text-xs">{k.keyPrefix}…</code>
                        {revoked ? (
                          <Badge variant="destructive">Revoked</Badge>
                        ) : (
                          <Badge variant="secondary">Active</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {scopeList.map((s) => (
                          <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                        ))}
                      </div>
                      <p className="text-xs text-dharma-ink-secondary">
                        {k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleString()}` : "Never used"}
                      </p>
                    </div>
                    {!revoked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={revoke.isPending}
                        aria-label={`Revoke API key ${k.name}`}
                        // GH #24 — this fired on the first click. Revoking a
                        // key breaks every integration authenticating with it,
                        // with no undo: the token is stored hashed, so it
                        // cannot be reissued, only replaced.
                        onClick={() => setPendingRevoke({ id: k.id, name: k.name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createdToken ? "Copy your API key" : "Create API key"}</DialogTitle>
            <DialogDescription>
              {createdToken
                ? "This key is shown only once. Store it securely now."
                : "Grant only the scopes this integration needs."}
            </DialogDescription>
          </DialogHeader>

          {!createdToken ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  placeholder="CI pipeline"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Scopes</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(scopesQuery.data ?? []).map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        data-testid={`scope-checkbox-${s}`}
                        checked={scopes[s] === true}
                        onCheckedChange={(c) => setScopes({ ...scopes, [s]: c === true })}
                      />
                      <code className="text-xs">{s}</code>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dharma-warning bg-dharma-warning-bg p-3 space-y-2">
              <p className="flex items-center gap-2 text-xs font-medium">
                <CheckCircle2 className="h-3 w-3" /> Copy now — it will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={createdToken} className="font-mono text-[11px]" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void navigator.clipboard.writeText(createdToken);
                    toast.success("API key copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            {!createdToken ? (
              <>
                <Button variant="outline" onClick={close}>Cancel</Button>
                <Button
                  disabled={name.trim().length < 2 || !Object.values(scopes).some(Boolean) || create.isPending}
                  onClick={() =>
                    create.mutate({
                      name,
                      scopes: Object.entries(scopes).filter(([, on]) => on).map(([s]) => s),
                    })
                  }
                >
                  Create key
                </Button>
              </>
            ) : (
              <Button onClick={close}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(o) => !o && setPendingRevoke(null)}
        title="Revoke this API key?"
        description={
          <>
            Every integration authenticating with{" "}
            <span className="font-medium">{pendingRevoke?.name}</span> starts failing
            immediately. This cannot be undone — the token is stored hashed, so it
            cannot be reissued; you would have to create a new key and update each
            caller. Revocation is written to the audit log.
          </>
        }
        confirmLabel={revoke.isPending ? "Revoking…" : "Revoke key"}
        pending={revoke.isPending}
        // Type-to-confirm: an API key revocation is silent from the UI's side —
        // nothing here shows the integrations that break — so the friction is
        // doing the work a visible blast radius would otherwise do.
        requireTypedConfirmation={pendingRevoke?.name}
        onConfirm={() => pendingRevoke && revoke.mutate({ id: pendingRevoke.id })}
      />
    </div>
  );
}
