"use client";

// Phase 8 Part 2 — white-label settings (UI_UX doc: "Live preview pane next
// to inputs (logo, colors, domain)"): split-pane form + preview.
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Globe, UploadCloud, CheckCircle2, Paintbrush } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export default function WhiteLabelSettingsPage() {
  const utils = api.useUtils();
  const settingsQuery = api.whiteLabel.getSettings.useQuery();

  const [primaryColor, setPrimaryColor] = useState("#d97706");
  const [customDomain, setCustomDomain] = useState("");
  const [css, setCss] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [pendingLogoKey, setPendingLogoKey] = useState<string | undefined>();

  useEffect(() => {
    const data = settingsQuery.data;
    if (data) {
      if (data.primaryColor) setPrimaryColor(data.primaryColor);
      setCustomDomain(data.customDomain ?? "");
      setCss(data.css ?? "");
      setLogoPreview(data.logoPreviewUrl);
    }
  }, [settingsQuery.data]);

  const requestLogoUpload = api.whiteLabel.requestLogoUpload.useMutation();
  const updateSettings = api.whiteLabel.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("White-label settings saved");
      setPendingLogoKey(undefined);
      void utils.whiteLabel.getSettings.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const verifyDomain = api.whiteLabel.verifyCustomDomain.useMutation({
    onSuccess: ({ customDomain: domain }) => {
      toast.success(`${domain} verified — white-label is live on that domain`);
      void utils.whiteLabel.getSettings.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const handleLogoFile = async (file: File) => {
    try {
      const { uploadUrl, logoKey } = await requestLogoUpload.mutateAsync({
        fileName: file.name,
      });
      const response = await fetch(uploadUrl, { method: "PUT", body: file });
      if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status})`);
      setPendingLogoKey(logoKey);
      setLogoPreview(URL.createObjectURL(file));
      toast.success("Logo uploaded — remember to save");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  if (settingsQuery.isLoading) {
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }
  const data = settingsQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">White-label</h1>
        <p className="text-sm text-muted-foreground">
          Brand this workspace for your organization — logo, accent color, and a custom domain.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Form pane ── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paintbrush className="h-4 w-4" /> Branding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Logo</Label>
                <div className="flex items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
                    <UploadCloud className="mr-2 h-4 w-4" /> Upload logo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleLogoFile(file);
                      }}
                    />
                  </label>
                  {pendingLogoKey && <Badge variant="secondary">unsaved</Badge>}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="primary-color">Primary color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="primary-color"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border bg-transparent"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-32 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="css">CSS overrides (advanced)</Label>
                <Textarea
                  id="css"
                  rows={5}
                  value={css}
                  onChange={(e) => setCss(e.target.value)}
                  placeholder=".sidebar { border-radius: 0; }"
                  className="font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4" /> Custom domain
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  placeholder="compliance.yourcompany.com"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Create a CNAME record pointing at{" "}
                <code className="font-mono">{data?.expectedCnameTarget}</code>, save, then
                verify. The theme only activates on a verified domain.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => verifyDomain.mutate()}
                  disabled={verifyDomain.isPending || !data?.customDomain}
                >
                  Verify CNAME
                </Button>
                {data?.customDomainVerified && (
                  <Badge variant="secondary">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Verified
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={() =>
              updateSettings.mutate({
                primaryColor,
                customDomain: customDomain || undefined,
                css: css || undefined,
                ...(pendingLogoKey ? { logoKey: pendingLogoKey } : {}),
              })
            }
            disabled={updateSettings.isPending}
          >
            Save white-label settings
          </Button>
        </div>

        {/* ── Live preview pane ── */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Live preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <div
                className="flex items-center gap-3 border-b p-3"
                style={{ borderBottomColor: primaryColor }}
              >
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoPreview} alt="Logo preview" className="h-8 max-w-[140px] object-contain" />
                ) : (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded font-bold text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    D
                  </div>
                )}
                <span className="text-sm font-semibold">
                  {customDomain || "your-workspace.dharma"}
                </span>
              </div>
              <div className="space-y-3 p-4">
                <div className="h-3 w-2/3 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
                <button
                  className="rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  Primary action
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Preview approximates how the accent color and logo apply across org pages.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
