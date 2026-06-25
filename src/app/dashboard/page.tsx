'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import { OverallReadinessScore } from '@/components/dashboard/OverallReadinessScore';
import { FrameworkProgressCards } from '@/components/dashboard/FrameworkProgressCards';
import { DomainGapHeatmap } from '@/components/dashboard/DomainGapHeatmap';
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed';
import { QuickActionsCard } from '@/components/dashboard/QuickActionsCard';
import { ExportReportCard } from '@/components/report/ExportReportCard';
import { api } from '@/hooks/trpc';

export default function DashboardPage() {
  const { data: stats, isLoading, error } = api.dashboard.getStats.useQuery();

  if (isLoading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <p className="text-red-600">Failed to load dashboard data: {error.message}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <p className="text-red-600">Failed to load dashboard data.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold text-stone-900 dark:text-stone-50 mb-2">
          Compliance Dashboard
        </h1>
        <p className="text-stone-600 dark:text-stone-400">
          Real-time overview of your compliance posture across all frameworks.
        </p>
      </motion.div>

      {/* Overall Readiness Score */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <OverallReadinessScore
          score={stats.overallScore}
          totalControls={stats.totalControls}
          compliantControls={stats.compliantControls}
        />
      </motion.div>

      {/* Quick Actions */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <QuickActionsCard />
      </motion.div>

      {/* Framework Progress Cards */}
      <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <h2 className="text-2xl font-bold text-stone-900 dark:text-stone-50 mb-4">
          Framework Progress
        </h2>
        <FrameworkProgressCards frameworks={stats.frameworks} />
      </motion.section>

      {/* Gap Heatmap */}
      <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <DomainGapHeatmap domains={stats.domains} />
      </motion.section>

      {/* Recent Activity */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-8"
      >
        <div className="lg:col-span-2">
          <RecentActivityFeed activities={stats.recentActivity} />
        </div>

        {/* Reporting Section */}
        <div>
          <h3 className="text-lg font-bold text-stone-900 dark:text-stone-50 mb-4">
            Reporting
          </h3>
          <ExportReportCard />
        </div>
      </motion.div>
    </motion.div>
  );
}
