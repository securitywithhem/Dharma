'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Domain {
  name: string;
  controlCount: number;
  compliantCount: number;
  evidenceCount: number;
  policyCount: number;
  completionPercentage: number;
  gap: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

interface DomainGapHeatmapProps {
  domains: Domain[];
}

export function DomainGapHeatmap({ domains }: DomainGapHeatmapProps) {
  const getGapColor = (gap: string) => {
    switch (gap) {
      case 'NONE':
        return 'bg-emerald-100 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100';
      case 'LOW':
        return 'bg-yellow-100 dark:bg-yellow-950 border-yellow-300 dark:border-yellow-700 text-yellow-900 dark:text-yellow-100';
      case 'MEDIUM':
        return 'bg-orange-100 dark:bg-orange-950 border-orange-300 dark:border-orange-700 text-orange-900 dark:text-orange-100';
      case 'HIGH':
        return 'bg-red-100 dark:bg-red-950 border-red-300 dark:border-red-700 text-red-900 dark:text-red-100';
      default:
        return 'bg-stone-100 dark:bg-stone-900';
    }
  };

  const getGapBadge = (gap: string) => {
    switch (gap) {
      case 'NONE':
        return 'success';
      case 'LOW':
        return 'secondary';
      case 'MEDIUM':
        return 'warning';
      case 'HIGH':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const sortedDomains = [...domains].sort(
    (a, b) => a.completionPercentage - b.completionPercentage
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance Domain Gap Analysis</CardTitle>
        <CardDescription>
          Identify which domains have gaps in evidence or policy coverage
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sortedDomains.map((domain, index) => (
            <motion.div
              key={domain.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`p-4 rounded-lg border ${getGapColor(domain.gap)} transition-all hover:shadow-sm`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h4 className="font-semibold text-sm">{domain.name}</h4>
                  <p className="text-xs opacity-75 mt-1">
                    {domain.compliantCount}/{domain.controlCount} controls compliant
                  </p>
                </div>
                <Badge variant={getGapBadge(domain.gap)} className="text-xs">
                  {domain.gap} Gap
                </Badge>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-stone-300 dark:bg-stone-700 rounded-full h-2 overflow-hidden mb-3">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${domain.completionPercentage}%` }}
                  transition={{ delay: index * 0.05 + 0.3, duration: 0.8 }}
                  className="h-full bg-gradient-to-r from-amber-600 to-emerald-600"
                />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="opacity-75">Evidence: </span>
                  <span className="font-medium">{domain.evidenceCount}</span>
                </div>
                <div>
                  <span className="opacity-75">Completion: </span>
                  <span className="font-medium">{domain.completionPercentage}%</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
