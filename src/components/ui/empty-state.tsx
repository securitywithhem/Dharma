import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';

/**
 * Zero-data panel content.
 *
 * An empty panel is an invitation to act, not a status report. The version this
 * replaces rendered an inbox glyph and the words "No recent activity" inside a
 * panel that was ~80% whitespace — it told the reader nothing they could do and
 * consumed a third of the viewport doing it.
 *
 * Three required parts: a small glyph, ONE sentence saying what will appear
 * here, and a route that would actually produce that content. `compact` caps
 * the vertical footprint so a zero-data side panel cannot out-shout the
 * populated cards above it.
 */

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** One sentence. What lands here, and when. */
  description: string;
  action?: {
    label: string;
    href: Route | string;
  };
  /** Tighter padding for side panels and in-card slots. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10',
        className,
      )}
    >
      {/* Decorative: the title and description already carry the meaning. The
          glyph uses the secondary ink, not the muted token, because it sits
          adjacent to text at the same optical weight. */}
      <Icon
        className={cn('text-dharma-ink-secondary', compact ? 'h-5 w-5' : 'h-6 w-6')}
        aria-hidden
      />

      <p className="text-data font-medium text-dharma-ink">{title}</p>

      <p className="max-w-[36ch] text-micro leading-relaxed text-dharma-ink-secondary">
        {description}
      </p>

      {action && (
        <Link
          href={action.href as Route}
          className="mt-1 rounded-dharma-sm text-micro font-medium text-dharma-accent-on-tint underline-offset-4 transition-colors duration-dharma-fast ease-dharma hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent"
        >
          {action.label} <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
}
