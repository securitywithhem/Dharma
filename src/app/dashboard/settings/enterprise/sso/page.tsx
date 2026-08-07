"use client";

// Phase 8 Part 1 — Enterprise SSO configuration (UI_UX doc "Enterprise
// Settings": tabs SAML / OIDC with input fields and a test button; callback
// URL shown read-only with copy after save). Path deviates from the task
// brief's (dashboard)/settings/... — this repo doesn't use a route group.
import React, { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, ShieldCheck, TestTube2, KeyRound } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SsoStatusBadge } from "@/components/enterprise/SsoStatusBadge";

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-dharma-ink-secondary">{label}</Label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function SsoSettingsPage() {
  const [tab, setTab] = useState<"SAML" | "OIDC">("SAML");
  const [metadata, setMetadata] = useState("");
  const [oidcForm, setOidcForm] = useState({ issuer: "", clientId: "", clientSecret: "" });
  const [enforceDialogOpen, setEnforceDialogOpen] = useState(false);
  const [pendingEnforce, setPendingEnforce] = useState<{
    enabled: boolean;
    token: string;
    warning: string;
  } | null>(null);
  const [scimToken, setScimToken] = useState<string | null>(null);

  const utils = api.useUtils();
  const configQuery = api.sso.getConfig.useQuery();

  const configureSaml = api.sso.configureSaml.useMutation({
    onSuccess: () => {
      toast.success("SAML configuration saved");
      void utils.sso.getConfig.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const configureOidc = api.sso.configureOidc.useMutation({
    onSuccess: () => {
      toast.success("OIDC configuration saved");
      setOidcForm((f) => ({ ...f, clientSecret: "" }));
      void utils.sso.getConfig.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const testConnection = api.sso.testConnection.useMutation({
    onSuccess: (result) =>
      toast.success(`${result.type} configuration is valid — callback: ${result.callbackUrl}`),
    onError: (error) => toast.error(error.message),
  });
  const enforceSso = api.sso.enforceSsoOnly.useMutation({
    onSuccess: (result) => {
      if (!result.applied && result.requiresConfirmation) {
        setPendingEnforce({
          enabled: pendingEnforce?.enabled ?? true,
          token: result.confirmationToken,
          warning: result.warning,
        });
        setEnforceDialogOpen(true);
        return;
      }
      toast.success(result.enabled ? "SSO-only login enforced" : "SSO enforcement disabled");
      setEnforceDialogOpen(false);
      setPendingEnforce(null);
      void utils.sso.getConfig.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const generateScimToken = api.sso.generateScimToken.useMutation({
    onSuccess: (result) => {
      setScimToken(result.token);
      void utils.sso.getConfig.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const disableScim = api.sso.disableScim.useMutation({
    onSuccess: () => {
      setScimToken(null);
      toast.success("SCIM provisioning disabled");
      void utils.sso.getConfig.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  // A bare full-height skeleton is indistinguishable from a blank page when the
  // query is slow, which is exactly how this page was reported. Keep the
  // heading and section shapes so the user can always tell what is loading —
  // and surface a real failure instead of leaving the area empty forever.
  if (configQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Single Sign-On</h1>
          <p className="text-sm text-dharma-ink-secondary">Loading your identity provider configuration…</p>
        </div>
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  // GH #21 — an error here must say WHICH failure this is. "Something went
  // wrong" sends an admin to support for a problem they could have fixed
  // themselves (wrong role) or that no amount of retrying will fix (not on
  // their plan). Retry is only offered where retrying can actually help.
  if (configQuery.isError) {
    const code = configQuery.error?.data?.code;
    const isPermission = code === "FORBIDDEN" || code === "UNAUTHORIZED";
    const isEntitlement = code === "PAYMENT_REQUIRED";

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Single Sign-On</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-dharma-danger-text" />
              {isPermission
                ? "You do not have access to SSO configuration"
                : isEntitlement
                  ? "SSO is not included in your plan"
                  : "We could not load your identity provider configuration"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-dharma-ink-secondary">
              {isPermission ? (
                <>
                  Configuring an identity provider requires the{" "}
                  <span className="font-mono text-xs">sso.configure</span> permission.
                  Ask an administrator of this organization to grant it, or to make
                  the change for you.
                </>
              ) : isEntitlement ? (
                <>
                  Enterprise SSO and SCIM are available on higher plans. Your existing
                  sign-in methods are unaffected.
                </>
              ) : (
                <>
                  This is a failure to read the configuration, not a sign that your SSO
                  is broken — members already signing in through your identity provider
                  are unaffected. If retrying does not help, the details below will
                  identify it for support.
                </>
              )}
            </p>

            {!isPermission && !isEntitlement && (
              <>
                <p className="font-mono text-xs text-dharma-ink-secondary break-words">
                  {code ?? "UNKNOWN"} — {configQuery.error?.message}
                </p>
                <Button variant="outline" onClick={() => void configQuery.refetch()}>
                  Retry
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const config = configQuery.data;
  const ssoStatus = config?.ssoEnforced
    ? "ENFORCED"
    : config?.ssoConfig
      ? "CONFIGURED"
      : "NOT_CONFIGURED";

  const requestEnforce = (enabled: boolean) => {
    setPendingEnforce({ enabled, token: "", warning: "" });
    enforceSso.mutate({ enabled });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Single Sign-On</h1>
          <p className="text-sm text-dharma-ink-secondary">
            Connect your identity provider via SAML 2.0 or OIDC.
          </p>
        </div>
        <SsoStatusBadge status={ssoStatus} />
      </div>

      {/* GH #21 — the explicit empty state. The setup form already rendered for
          an unconfigured org, but with nothing distinguishing "you have not set
          this up yet" from "we failed to load what you did set up" — which is
          exactly the ambiguity that made the reported spinner so hard to read.
          Say which one this is. */}
      {ssoStatus === "NOT_CONFIGURED" && (
        <div
          role="status"
          className="rounded-lg border border-dashed p-4 text-sm text-dharma-ink-secondary"
        >
          <p className="font-medium text-dharma-ink">
            No identity provider is configured yet.
          </p>
          <p className="mt-1">
            Pick SAML 2.0 or OIDC below and enter your IdP&apos;s details. Nothing
            changes for your members until you save — existing sign-in methods keep
            working, and SSO-only enforcement is a separate, confirmed step.
          </p>
        </div>
      )}

      <div className="flex gap-2 border-b">
        {(["SAML", "OIDC"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-dharma-accent text-dharma-accent-on-tint"
                : "border-transparent text-dharma-ink-secondary hover:text-dharma-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "SAML" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SAML 2.0</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="saml-metadata">IdP metadata URL or XML</Label>
              <Textarea
                id="saml-metadata"
                rows={6}
                placeholder="https://idp.example.com/metadata or paste the metadata XML"
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => configureSaml.mutate({ metadataXmlOrUrl: metadata })}
                disabled={!metadata.trim() || configureSaml.isPending}
              >
                Save SAML configuration
              </Button>
              <Button
                variant="outline"
                onClick={() => testConnection.mutate()}
                disabled={testConnection.isPending || !config?.ssoConfig}
              >
                <TestTube2 className="mr-2 h-4 w-4" /> Test connection
              </Button>
            </div>
            {config?.urls && (
              <div className="grid gap-3 pt-2">
                <CopyField label="ACS (callback) URL — give this to your IdP" value={config.urls.samlAcs} />
                <CopyField label="SP Entity ID / metadata URL" value={config.urls.samlSpEntityId} />
                <CopyField label="Login URL for your members" value={config.urls.samlLogin} />
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">OpenID Connect</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="oidc-issuer">Issuer URL</Label>
                <Input
                  id="oidc-issuer"
                  placeholder="https://login.example.com"
                  value={oidcForm.issuer}
                  onChange={(e) => setOidcForm({ ...oidcForm, issuer: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="oidc-client-id">Client ID</Label>
                <Input
                  id="oidc-client-id"
                  value={oidcForm.clientId}
                  onChange={(e) => setOidcForm({ ...oidcForm, clientId: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="oidc-client-secret">Client secret</Label>
                <Input
                  id="oidc-client-secret"
                  type="password"
                  autoComplete="off"
                  value={oidcForm.clientSecret}
                  onChange={(e) => setOidcForm({ ...oidcForm, clientSecret: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => configureOidc.mutate(oidcForm)}
                disabled={
                  !oidcForm.issuer || !oidcForm.clientId || !oidcForm.clientSecret ||
                  configureOidc.isPending
                }
              >
                Save OIDC configuration
              </Button>
              <Button
                variant="outline"
                onClick={() => testConnection.mutate()}
                disabled={testConnection.isPending || !config?.ssoConfig}
              >
                <TestTube2 className="mr-2 h-4 w-4" /> Test connection
              </Button>
            </div>
            {config?.urls && (
              <div className="grid gap-3 pt-2">
                <CopyField label="Redirect URI — register this with your IdP" value={config.urls.oidcRedirect} />
                <CopyField label="Login URL for your members" value={config.urls.oidcLogin} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> SSO-only enforcement
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-dharma-ink-secondary max-w-xl">
            When enforced, password and Google sign-in are blocked for every member of this
            organization — only your identity provider can start a session.
          </p>
          <Button
            variant={config?.ssoEnforced ? "outline" : "default"}
            disabled={enforceSso.isPending || (!config?.ssoConfig && !config?.ssoEnforced)}
            onClick={() => requestEnforce(!config?.ssoEnforced)}
          >
            {config?.ssoEnforced ? "Disable enforcement" : "Enforce SSO-only login"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> SCIM provisioning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-dharma-ink-secondary">
            Let Okta or Azure AD create, update, and deactivate members automatically.
          </p>
          {config?.urls && config.scimEnabled && (
            <CopyField label="SCIM base URL" value={config.urls.scimBase} />
          )}
          {scimToken && (
            <div className="rounded-md border border-dharma-warning bg-dharma-warning-bg p-3 space-y-2">
              <p className="text-xs font-medium">
                Copy this bearer token now — it is shown only once.
              </p>
              <CopyField label="SCIM bearer token" value={scimToken} />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => generateScimToken.mutate()}
              disabled={generateScimToken.isPending}
            >
              {config?.scimEnabled ? "Rotate token" : "Enable SCIM & generate token"}
            </Button>
            {config?.scimEnabled && (
              <Button
                variant="outline"
                onClick={() => disableScim.mutate()}
                disabled={disableScim.isPending}
              >
                Disable SCIM
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Dialog open={enforceDialogOpen} onOpenChange={setEnforceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingEnforce?.enabled ? "Enforce SSO-only login?" : "Disable SSO enforcement?"}
            </DialogTitle>
            <DialogDescription>{pendingEnforce?.warning}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnforceDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={enforceSso.isPending}
              onClick={() =>
                pendingEnforce &&
                enforceSso.mutate({
                  enabled: pendingEnforce.enabled,
                  confirmationToken: pendingEnforce.token,
                })
              }
            >
              I understand — apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
