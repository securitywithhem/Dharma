"use client";

import { api } from "@/lib/trpc";
import { FileText, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";

export default function AuditorPortalPage() {
  const { data: organization } = api.settings.organization.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dharma-ink">Auditor Portal</h1>
        <p className="text-dharma-ink-secondary mt-1">
          Reviewing evidence and controls for: <span className="font-semibold text-dharma-ink-secondary">{organization?.name}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-dharma-surface p-6 rounded-lg border border-dharma-border">
          <div className="text-sm font-medium text-dharma-ink-secondary mb-1">Users</div>
          <div className="text-3xl font-bold text-dharma-ink">{organization?._count?.users ?? 0}</div>
        </div>
        <div className="bg-dharma-surface p-6 rounded-lg border border-dharma-border">
          <div className="text-sm font-medium text-dharma-ink-secondary mb-1">Frameworks</div>
          <div className="text-3xl font-bold text-dharma-ink">{organization?._count?.frameworks ?? 0}</div>
        </div>
        <div className="bg-dharma-surface p-6 rounded-lg border border-dharma-border">
          <div className="text-sm font-medium text-dharma-ink-secondary mb-1">Evidences</div>
          <div className="text-3xl font-bold text-dharma-ink">{organization?._count?.evidences ?? 0}</div>
        </div>
        <div className="bg-dharma-surface p-6 rounded-lg border border-dharma-border">
          <div className="text-sm font-medium text-dharma-ink-secondary mb-1">Policies</div>
          <div className="text-3xl font-bold text-dharma-ink">{organization?._count?.policies ?? 0}</div>
        </div>
      </div>

      <div className="bg-dharma-surface rounded-lg border border-dharma-border p-8 text-center mt-8">
        <ShieldAlert className="w-12 h-12 text-dharma-accent-on-tint mx-auto mb-4" />
        <h2 className="text-xl font-medium text-dharma-ink">Read-Only Mode Active</h2>
        <p className="text-dharma-ink-secondary max-w-lg mx-auto mt-2">
          You are currently viewing this environment as an auditor. Modifications, uploads, and deletions are strictly disabled at the server level.
        </p>
      </div>
    </div>
  );
}
