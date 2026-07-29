'use client';

import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Shield,
  Upload,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import type { LucideIcon } from 'lucide-react';

interface ActivityItem {
  id: string;
  action: string;
  entity: string;
  timestamp: Date;
  userName?: string;
}

interface RecentActivityFeedProps {
  activities: ActivityItem[];
}

/**
 * Icons carry the action type; colour does not. The previous version tinted
 * each icon a different raw palette value (blue/purple/emerald/amber), which
 * read as five unrelated status meanings on a feed where nothing is a status.
 */
const actionIcons: Record<string, LucideIcon> = {
  EVIDENCE_UPLOAD: Upload,
  POLICY_PUBLISH: FileText,
  CONTROL_UPDATE: CheckCircle2,
  REPORT_EXPORT: Shield,
};

function labelFor(action: string): string {
  const words = action.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function RecentActivityFeed({ activities }: RecentActivityFeedProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Latest compliance actions in your organisation</CardDescription>
      </CardHeader>

      <CardContent>
        {activities.length === 0 ? (
          <div className="py-10 text-center">
            <Inbox className="mx-auto h-7 w-7 text-dharma-ink-secondary" aria-hidden />
            <p className="mt-2 text-data text-dharma-ink-secondary">No recent activity</p>
          </div>
        ) : (
          /* A timeline rule instead of a stack of bordered boxes: the events
             share one continuous spine, so the eye tracks time rather than
             re-parsing a card boundary on every row. */
          <ol className="relative space-y-0 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-border">
            {activities.map((activity) => {
              const Icon = actionIcons[activity.action] ?? Clock;
              return (
                <li key={activity.id} className="relative flex gap-3 py-2 pl-0">
                  <span className="relative z-10 mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border border-dharma-border bg-dharma-surface">
                    <Icon className="h-3 w-3 text-dharma-ink-secondary" aria-hidden />
                  </span>

                  <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-data font-medium text-dharma-ink">
                        {labelFor(activity.action)}
                      </p>
                      <p className="truncate text-micro text-dharma-ink-secondary">
                        {activity.entity}
                        {activity.userName ? ` · ${activity.userName}` : ''}
                      </p>
                    </div>
                    <time
                      dateTime={new Date(activity.timestamp).toISOString()}
                      title={new Date(activity.timestamp).toLocaleString()}
                      className="shrink-0 whitespace-nowrap text-micro tabular-nums text-dharma-ink-secondary"
                    >
                      {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
