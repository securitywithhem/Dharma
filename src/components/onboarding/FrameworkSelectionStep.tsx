'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AvailableFrameworks } from '@/lib/types/onboarding';
import { api } from '@/hooks/trpc';
import { toast } from 'sonner';

interface FrameworkSelectionStepProps {
  onNext: (data: any) => void;
  onBack: () => void;
}

export function FrameworkSelectionStep({
  onNext,
  onBack,
}: FrameworkSelectionStepProps) {
  const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const selectFrameworksMutation = api.onboarding.selectFrameworks.useMutation();

  const handleFrameworkToggle = (frameworkKey: string) => {
    setSelectedFrameworks((prev) =>
      prev.includes(frameworkKey)
        ? prev.filter((f) => f !== frameworkKey)
        : [...prev, frameworkKey]
    );
  };

  const handleNext = async () => {
    if (selectedFrameworks.length === 0) {
      toast.error('Please select at least one framework');
      return;
    }

    setIsLoading(true);
    try {
      const result = await selectFrameworksMutation.mutateAsync({
        frameworks: selectedFrameworks as any,
      });
      toast.success(`${result.frameworks.length} frameworks selected!`);
      onNext({ frameworks: selectedFrameworks });
    } catch (error) {
      toast.error('Failed to select frameworks');
    } finally {
      setIsLoading(false);
    }
  };

  const frameworks = Object.entries(AvailableFrameworks).map(([key, value]) => ({
    key,
    label: value,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Your Compliance Frameworks</CardTitle>
        <CardDescription>
          Choose the frameworks you need to comply with. You can add more later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {frameworks.map((fw, index) => (
            <motion.div
              key={fw.key}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <label className="flex items-center gap-3 p-4 rounded-lg border border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-900 cursor-pointer transition-colors">
                <Checkbox
                  checked={selectedFrameworks.includes(fw.key)}
                  onCheckedChange={() => handleFrameworkToggle(fw.key)}
                />
                <span className="font-medium text-stone-900 dark:text-stone-100">
                  {fw.label}
                </span>
              </label>
            </motion.div>
          ))}
        </div>

        <div className="flex gap-3 mt-8">
          <Button
            variant="outline"
            onClick={onBack}
            disabled={isLoading}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            onClick={handleNext}
            disabled={selectedFrameworks.length === 0 || isLoading}
            className="flex-1"
          >
            {isLoading ? 'Loading...' : 'Continue'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
