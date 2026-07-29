'use client';

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { VulnerabilitySwimLanes } from '@/components/dashboard/VulnerabilitySwimLanes';
import { Button } from '@/components/ui/button';
import type { Route } from 'next';

/**
 * Vulnerabilities Triage Dashboard (Swimlane View)
 *
 * This page provides a swimlane/kanban-style interface for triaging and
 * remediating vulnerabilities from pentests and security scans.
 *
 * Features:
 * - Drag-to-move vulnerabilities between swim lanes (New → Triaging → In Remediation → Closed)
 * - Filter by CVSS score, asset type, owner, and due date
 * - Bulk actions (assign owner, set due date, move to status)
 * - Visual severity indicators (CVSS color coding: red 7+, amber 4-6.9, green <4)
 * - Keyboard support (Shift+click for range selection)
 * - Desktop-first responsive design
 *
 * Alternative view: Back to list view at /dashboard/vulnerabilities
 */
export default function VulnerabilitiesTriagePage() {
  const handleStatusChange = (vulnId: string, newStatus: string) => {
    console.log(`Moving vulnerability ${vulnId} to status: ${newStatus}`);
    // TODO: Integrate with backend API to persist status change
    // await api.vulnerability.updateStatus.mutate({ id: vulnId, status: newStatus });
  };

  return (
    <div className="space-y-6">
      {/* Header with breadcrumb */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={'/dashboard/vulnerabilities' as Route}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-dharma-border text-dharma-ink-secondary hover:text-dharma-ink"
            aria-label="Back to vulnerabilities list"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-dharma-ink">
              Triage Board
            </h1>
            <p className="mt-0.5 text-data text-dharma-ink-secondary">
              Swimlane view for managing remediation workflow
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={'/dashboard/vulnerabilities' as Route}>
            <Button
              variant="outline"
              size="sm"
            >
              List View
            </Button>
          </Link>
        </div>
      </div>

      {/* Swimlane component */}
      <VulnerabilitySwimLanes onStatusChange={handleStatusChange} />
    </div>
  );
}
