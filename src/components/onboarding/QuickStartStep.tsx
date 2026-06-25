'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface QuickStartStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function QuickStartStep({ onNext, onBack }: QuickStartStepProps) {
  const tips = [
    {
      title: 'Upload Evidence',
      description: 'Start by uploading screenshots, policies, and logs to support compliance.',
      icon: '📄',
    },
    {
      title: 'Generate Policies',
      description: 'Use AI to draft compliance policies tailored to your frameworks.',
      icon: '✨',
    },
    {
      title: 'Track Controls',
      description: 'Monitor compliance status across all controls in real-time.',
      icon: '📊',
    },
    {
      title: 'Export Reports',
      description: 'Generate signed, audit-ready compliance reports anytime.',
      icon: '📋',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Start Guide</CardTitle>
        <CardDescription>
          Here's what you can do with Dharma to accelerate your compliance journey.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {tips.map((tip, index) => (
            <motion.div
              key={tip.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="p-4 rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800"
            >
              <div className="text-2xl mb-2">{tip.icon}</div>
              <h4 className="font-semibold text-sm mb-1">{tip.title}</h4>
              <p className="text-xs text-stone-600 dark:text-stone-400">
                {tip.description}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onBack}
            className="flex-1"
          >
            Back
          </Button>
          <Button onClick={onNext} className="flex-1">
            Complete Setup
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
