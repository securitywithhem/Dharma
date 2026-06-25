'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Upload,
  FileText,
  Shield,
  CheckCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';

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

export function RecentActivityFeed({
  activities,
}: RecentActivityFeedProps) {
  const getActionIcon = (action: string) => {
    switch (action) {
      case 'EVIDENCE_UPLOAD':
        return <Upload className="w-4 h-4 text-blue-600" />;
      case 'POLICY_PUBLISH':
        return <FileText className="w-4 h-4 text-purple-600" />;
      case 'CONTROL_UPDATE':
        return <CheckCircle className="w-4 h-4 text-emerald-600" />;
      case 'REPORT_EXPORT':
        return <Shield className="w-4 h-4 text-amber-600" />;
      default:
        return <Clock className="w-4 h-4 text-stone-600" />;
    }
  };

  const getActionLabel = (action: string) => {
    return action.replace(/_/g, ' ').toLowerCase();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest compliance actions in your organization</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <AnimatePresence>
            {activities.length === 0 ? (
              <div className="py-8 text-center text-stone-500 dark:text-stone-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recent activity</p>
              </div>
            ) : (
              activities.map((activity, index) => (
                <motion.div
                  key={activity.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex gap-3 items-start p-3 rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                >
                  <div className="mt-1">{getActionIcon(activity.action)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-900 dark:text-stone-100 capitalize">
                      {getActionLabel(activity.action)}
                    </p>
                    <p className="text-xs text-stone-600 dark:text-stone-400">
                      {activity.entity} {activity.userName && `by ${activity.userName}`}
                    </p>
                  </div>
                  <div className="text-xs text-stone-500 dark:text-stone-500 whitespace-nowrap">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
