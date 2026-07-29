'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3, ChevronRight, FileText, Shield, Upload } from 'lucide-react';

import type { Route } from 'next';
import type { LucideIcon } from 'lucide-react';

interface QuickAction {
  label: string;
  description: string;
  icon: LucideIcon;
  href: Route;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Add proof',
    description: 'Upload files that show you meet a requirement',
    icon: Upload,
    href: '/dashboard/evidence' as Route,
  },
  {
    label: 'Auto-draft policy',
    description: 'Create a smart draft for a required policy',
    icon: FileText,
    href: '/dashboard/policies/new' as Route,
  },
  {
    label: 'View goals',
    description: 'Track the requirements behind each certification goal',
    icon: BarChart3,
    href: '/dashboard/frameworks' as Route,
  },
  {
    label: 'Share with auditor',
    description: 'Generate a read-only report for external review',
    icon: Shield,
    href: '/dashboard/settings' as Route,
  },
];

/**
 * A vertical list of link rows, not a grid of buttons.
 *
 * These actions each carry a label AND a sentence of description, which a
 * <Button> cannot hold — its `whitespace-nowrap` base fights the wrapped text,
 * and a 4-column grid inside a one-third-width dashboard column collapsed the
 * cells until the labels overlapped. A row list also degrades correctly at any
 * column width.
 */
export function QuickActionsCard() {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <ul>
          {QUICK_ACTIONS.map(({ label, description, icon: Icon, href }) => (
            <li key={label}>
              <Link
                href={href}
                className="group flex items-start gap-3 rounded-md p-2.5 transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors duration-150 group-hover:border-primary/30 group-hover:bg-primary/8 group-hover:text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-data font-medium text-foreground">{label}</span>
                  <span className="mt-0.5 block text-micro leading-snug text-muted-foreground">
                    {description}
                  </span>
                </span>
                <ChevronRight className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
