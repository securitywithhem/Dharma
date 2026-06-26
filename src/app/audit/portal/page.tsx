"use client";

import { api } from "@/lib/trpc";
import { FileText, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";

export default function AuditorPortalPage() {
  const { data: organization } = api.settings.organization.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Auditor Portal</h1>
        <p className="text-gray-500 mt-1">
          Reviewing evidence and controls for: <span className="font-semibold text-gray-700">{organization?.name}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="text-sm font-medium text-gray-500 mb-1">Users</div>
          <div className="text-3xl font-bold text-gray-900">{organization?._count?.users ?? 0}</div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="text-sm font-medium text-gray-500 mb-1">Frameworks</div>
          <div className="text-3xl font-bold text-gray-900">{organization?._count?.frameworks ?? 0}</div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="text-sm font-medium text-gray-500 mb-1">Evidences</div>
          <div className="text-3xl font-bold text-gray-900">{organization?._count?.evidences ?? 0}</div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="text-sm font-medium text-gray-500 mb-1">Policies</div>
          <div className="text-3xl font-bold text-gray-900">{organization?._count?.policies ?? 0}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center mt-8">
        <ShieldAlert className="w-12 h-12 text-indigo-300 mx-auto mb-4" />
        <h2 className="text-xl font-medium text-gray-900">Read-Only Mode Active</h2>
        <p className="text-gray-500 max-w-lg mx-auto mt-2">
          You are currently viewing this environment as an auditor. Modifications, uploads, and deletions are strictly disabled at the server level.
        </p>
      </div>
    </div>
  );
}
