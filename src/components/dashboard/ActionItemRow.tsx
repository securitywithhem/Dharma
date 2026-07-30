'use client';

import React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

import type { Route } from 'next';

/**
 * A single "next thing to do" row.
 *
 * Replaces three near-identical bordered blocks with p-3.5 internal padding and
 * a dead-end string ("No evidence yet") where a call to action belonged. The
 * row is now a scan line: rank, title, one muted meta line, an urgency chip on
 * the right, and a CTA that names the actual next step.
 *
 * The row itself is the link, so the CTA text is decorative (aria-hidden would
 * be wrong — it is the accessible description of where the link goes, and it
 * reads correctly in sequence after the title).
 */

export interface ActionItem {
  id: string;
  title: string;
  frameworkName: string;
  domain: string;
  status: string;
  evidenceCount: number;
}

export interface ActionItemRowProps {
  item: ActionItem;
  /** 1-based display rank. */
  rank: number;
}

export function ActionItemRow({ item, rank }: ActionItemRowProps) {
  const needsEvidence = item.evidenceCount === 0;

  return (
    <li>
      <Link
        href={`/dashboard/controls/${item.id}` as Route}
        className="group flex items-start gap-3 rounded-dharma-md px-2 py-2.5 transition-colors duration-dharma-fast ease-dharma hover:bg-dharma-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent"
      >
        <span
          data-numeric
          aria-hidden
          className="mt-0.5 w-4 shrink-0 text-right font-mono text-micro tabular-nums text-dharma-ink-secondary"
        >
          {rank}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-data font-medium text-dharma-ink">{item.title}</p>
          <p className="mt-0.5 truncate text-micro text-dharma-ink-secondary">
            {item.frameworkName} · {item.domain}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {/*
            Urgency, not status. A control with no evidence at all is the thing
            an auditor finds first, so it is the only state escalated here;
            everything else reads as ordinary outstanding work.
          */}
          <Badge variant={needsEvidence ? 'critical' : 'secondary'}>
            {needsEvidence ? (
              'no evidence'
            ) : (
              <span data-numeric className="tabular-nums">
                {item.evidenceCount} evidence
              </span>
            )}
          </Badge>

          <span className="text-micro font-medium text-dharma-accent-on-tint opacity-0 transition-opacity duration-dharma-fast group-hover:opacity-100 group-focus-visible:opacity-100">
            {needsEvidence ? 'Add evidence' : 'Review'} <span aria-hidden>→</span>
          </span>
        </div>
      </Link>
    </li>
  );
}
