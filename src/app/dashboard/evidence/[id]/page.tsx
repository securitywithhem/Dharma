"use client";

/**
 * Evidence detail page – src/app/dashboard/evidence/[id]/page.tsx
 *
 * Shows the full evidence record (file preview, metadata, associated control)
 * alongside the AI Suggestions Panel for control recommendations.
 */

import { notFound } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AISuggestionsPanel } from "./AISuggestionsPanel";
import { useSession } from "next-auth/react";

export default function EvidenceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: session } = useSession();
  const [isDownloading, setIsDownloading] = useState(false);

  const evidenceQuery = api.evidence.getById.useQuery(
    { id: params.id },
    { staleTime: 30_000 },
  );

  if (evidenceQuery.isLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (evidenceQuery.isError || !evidenceQuery.data) {
    return notFound();
  }

  const evidence = evidenceQuery.data;

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      window.open(evidence.downloadUrl, "_blank", "noopener,noreferrer");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-6">
      {/* Back navigation */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/evidence"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All Evidence
        </Link>
      </div>

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {evidence.fileName}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Uploaded{" "}
            {new Date(evidence.createdAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleDownload()}
          disabled={isDownloading}
          aria-label={`Download ${evidence.fileName}`}
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-1.5" />
          )}
          Download
        </Button>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left/main column: metadata + control info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Evidence metadata card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Evidence Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Type</dt>
                  <dd className="mt-0.5 font-medium">{evidence.type.replace(/_/g, " ")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Collected</dt>
                  <dd className="mt-0.5 font-medium">
                    {new Date(evidence.collectedAt).toLocaleDateString("en-IN")}
                  </dd>
                </div>
                {evidence.expiresAt && (
                  <div>
                    <dt className="text-muted-foreground text-xs">Expires</dt>
                    <dd className="mt-0.5 font-medium">
                      {new Date(evidence.expiresAt).toLocaleDateString("en-IN")}
                    </dd>
                  </div>
                )}
                {evidence.summary && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground text-xs">AI Summary</dt>
                    <dd className="mt-0.5 text-sm italic text-muted-foreground">
                      &ldquo;{evidence.summary}&rdquo;
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Associated control card */}
          {evidence.control && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <CardTitle className="text-base">Linked Control</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-start gap-2">
                  <Badge
                    variant="outline"
                    className="text-xs shrink-0 mt-0.5"
                  >
                    {evidence.control.domain}
                  </Badge>
                  <p className="text-sm font-medium">{evidence.control.title}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: AI Suggestions Panel */}
        <div className="lg:col-span-1">
          {session?.user?.organizationId ? (
            <AISuggestionsPanel
              evidenceId={params.id}
              organizationId={session.user.organizationId}
              currentControlId={evidence.control?.id ?? null}
            />
          ) : (
            <Card className="animate-pulse">
              <CardContent className="py-10">
                <Skeleton className="h-40 w-full" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

