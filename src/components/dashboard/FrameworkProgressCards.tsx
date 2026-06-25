'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

interface Framework {
  id: string;
  name: string;
  version: string;
  progress: number;
  controlCount: number;
  compliantCount: number;
}

interface FrameworkProgressCardsProps {
  frameworks: Framework[];
}

export function FrameworkProgressCards({
  frameworks,
}: FrameworkProgressCardsProps) {
  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'bg-emerald-600';
    if (progress >= 60) return 'bg-amber-600';
    return 'bg-red-600';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {frameworks.map((framework, index) => (
        <motion.div
          key={framework.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{framework.name}</CardTitle>
                  <CardDescription>v{framework.version}</CardDescription>
                </div>
                <Badge variant={framework.progress >= 80 ? 'success' : (framework.progress >= 60 ? 'warning' : 'destructive')}>
                  {framework.progress}%
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-stone-600 dark:text-stone-400">Progress</span>
                  <span className="font-medium">
                    {framework.compliantCount}/{framework.controlCount} controls
                  </span>
                </div>
                <Progress
                  value={framework.progress}
                  className="h-2"
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
