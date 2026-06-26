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
      title: 'Add Proof',
      description: 'Upload screenshots, policies, and logs that prove each requirement.',
      icon: '📄',
    },
    {
      title: 'Auto-Draft Policies',
      description: 'Use AI to create a first draft for the policies you need.',
      icon: '✨',
    },
    {
      title: 'Track Progress',
      description: 'See what is done, what is missing, and what needs attention next.',
      icon: '📊',
    },
    {
      title: 'Share Reports',
      description: 'Generate a report you can send to auditors or customers.',
      icon: '📋',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>How founders use Dharma</CardTitle>
        <CardDescription>
          Here is the fastest path from signup to audit-ready.
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
            Go to Compliance Status
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
