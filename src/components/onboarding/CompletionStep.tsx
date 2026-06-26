'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';
import { api } from '@/hooks/trpc';
import { toast } from 'sonner';

export function CompletionStep() {
  const router = useRouter();
  const completeOnboardingMutation = api.onboarding.completeOnboarding.useMutation();

  useEffect(() => {
    // Auto-redirect after 2 seconds
    const timer = setTimeout(() => {
      handleGoToDashboard();
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const handleGoToDashboard = async () => {
    try {
      await completeOnboardingMutation.mutateAsync();
      router.push('/dashboard');
    } catch (error) {
      toast.error('Failed to complete onboarding');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <CheckCircle className="w-24 h-24 text-emerald-600 mx-auto mb-6" />
        </motion.div>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-3xl font-bold text-stone-900 dark:text-stone-50 mb-2 text-center"
      >
        You're ready to go!
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-stone-600 dark:text-stone-400 text-center mb-8 max-w-md"
      >
        Your workspace is set up. Taking you to Compliance Status...
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
      >
        <Button onClick={handleGoToDashboard} size="lg">
          Open Compliance Status
        </Button>
      </motion.div>
    </div>
  );
}
