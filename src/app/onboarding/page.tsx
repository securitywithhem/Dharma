'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { OnboardingStep } from '@/lib/types/onboarding';
import { OrganizationSetupStep } from '@/components/onboarding/OrganizationSetupStep';
import { FrameworkSelectionStep } from '@/components/onboarding/FrameworkSelectionStep';
import { TeamSetupStep } from '@/components/onboarding/TeamSetupStep';
import { QuickStartStep } from '@/components/onboarding/QuickStartStep';
import { CompletionStep } from '@/components/onboarding/CompletionStep';

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(
    OnboardingStep.ORGANIZATION_SETUP
  );
  const [formData, setFormData] = useState({
    organizationName: '',
    industry: '',
    frameworks: [],
    teamMembers: [],
  });

  const steps = [
    { id: OnboardingStep.ORGANIZATION_SETUP, label: 'Organization Setup' },
    { id: OnboardingStep.FRAMEWORK_SELECTION, label: 'Select Frameworks' },
    { id: OnboardingStep.TEAM_SETUP, label: 'Team Setup' },
    { id: OnboardingStep.QUICK_START, label: 'Quick Start' },
    { id: OnboardingStep.COMPLETION, label: 'Complete!' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const renderStep = () => {
    switch (currentStep) {
      case OnboardingStep.ORGANIZATION_SETUP:
        return (
          <OrganizationSetupStep
            onNext={(data) => {
              setFormData({ ...formData, ...data });
              setCurrentStep(OnboardingStep.FRAMEWORK_SELECTION);
            }}
          />
        );
      case OnboardingStep.FRAMEWORK_SELECTION:
        return (
          <FrameworkSelectionStep
            onNext={(data) => {
              setFormData({ ...formData, ...data });
              setCurrentStep(OnboardingStep.TEAM_SETUP);
            }}
            onBack={() => setCurrentStep(OnboardingStep.ORGANIZATION_SETUP)}
          />
        );
      case OnboardingStep.TEAM_SETUP:
        return (
          <TeamSetupStep
            onNext={(data) => {
              setFormData({ ...formData, ...data });
              setCurrentStep(OnboardingStep.QUICK_START);
            }}
            onBack={() => setCurrentStep(OnboardingStep.FRAMEWORK_SELECTION)}
          />
        );
      case OnboardingStep.QUICK_START:
        return (
          <QuickStartStep
            onNext={() => setCurrentStep(OnboardingStep.COMPLETION)}
            onBack={() => setCurrentStep(OnboardingStep.TEAM_SETUP)}
          />
        );
      case OnboardingStep.COMPLETION:
        return <CompletionStep />;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-2xl">
        {/* Progress Bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-12"
        >
          <div className="flex items-center justify-between mb-4">
            {steps.map((step, index) => (
              <motion.div
                key={step.id}
                className="flex flex-col items-center z-10"
              >
                <motion.div
                  animate={{
                    backgroundColor:
                      index <= currentStepIndex ? '#D97706' : '#E7E5E4',
                  }}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-md"
                >
                  {index + 1}
                </motion.div>
                <p className="text-xs mt-2 text-stone-600 dark:text-stone-400 text-center w-20">
                  {step.label}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Progress Line */}
          <div className="w-full h-1 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden -mt-16 mb-16 relative top-5 z-0">
            <motion.div
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
              className="h-full bg-gradient-to-r from-amber-600 to-emerald-600"
            />
          </div>
        </motion.div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
