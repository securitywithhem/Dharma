'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileText, BarChart3, Shield } from 'lucide-react';

interface QuickAction {
  label: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive' | 'ghost';
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Upload Evidence',
    description: 'Add files to support compliance',
    icon: <Upload className="w-5 h-5" />,
    href: '/dashboard/evidence',
    variant: 'default',
  },
  {
    label: 'Generate Policy',
    description: 'Create AI-drafted compliance policies',
    icon: <FileText className="w-5 h-5" />,
    href: '/dashboard/policies/new',
    variant: 'default',
  },
  {
    label: 'View Frameworks',
    description: 'Track control requirements',
    icon: <BarChart3 className="w-5 h-5" />,
    href: '/dashboard/frameworks',
    variant: 'outline',
  },
  {
    label: 'Export Report',
    description: 'Generate signed compliance report',
    icon: <Shield className="w-5 h-5" />,
    href: '/dashboard',
    variant: 'outline',
  },
];

export function QuickActionsCard() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map((action, index) => (
            <motion.div
              key={action.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Link href={action.href as any}>
                <Button
                  variant={action.variant}
                  className="w-full h-auto flex flex-col items-start gap-2 p-4 rounded-lg"
                >
                  <div className="flex items-center gap-2 w-full">
                    {action.icon}
                    <span className="font-semibold text-sm">{action.label}</span>
                  </div>
                  <span className="text-xs text-stone-600 dark:text-stone-400 text-left leading-tight whitespace-normal">
                    {action.description}
                  </span>
                </Button>
              </Link>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
