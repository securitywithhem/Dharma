'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface OverallReadinessScoreProps {
  score: number;
  totalControls: number;
  compliantControls: number;
}

export function OverallReadinessScore({
  score,
  totalControls,
  compliantControls,
}: OverallReadinessScoreProps) {
  const [displayedScore, setDisplayedScore] = useState(0);

  // Animate score counter
  useEffect(() => {
    let animationFrame: number;
    let current = 0;

    const animate = () => {
      if (current < score) {
        current = Math.min(current + 2, score);
        setDisplayedScore(current);
        animationFrame = requestAnimationFrame(animate);
      } else {
        setDisplayedScore(score);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [score]);

  // Determine color based on score
  const getColor = (s: number) => {
    if (s >= 80) return 'text-emerald-600 dark:text-emerald-400';
    if (s >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getProgressColor = (s: number) => {
    if (s >= 80) return 'text-emerald-600';
    if (s >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  const circumference = 2 * Math.PI * 45; // radius = 45
  const strokeDashoffset = circumference - (displayedScore / 100) * circumference;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center p-8 rounded-xl bg-gradient-to-br from-stone-50 to-stone-100 dark:from-stone-900 dark:to-stone-800 border border-stone-200 dark:border-stone-700"
    >
      {/* Circular Progress Indicator */}
      <div className="relative w-40 h-40 mb-6">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            className="text-stone-200 dark:text-stone-800"
          />
          {/* Progress circle */}
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            className={getProgressColor(score)}
            initial={{ strokeDasharray: circumference, strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            strokeDasharray={circumference}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <div className={`text-4xl font-bold ${getColor(score)}`}>
              {displayedScore}%
            </div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mt-2 text-center">
              Compliance
            </div>
          </motion.div>
        </div>
      </div>

      {/* Stats */}
      <div className="text-center space-y-2">
        <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
          {compliantControls} of {totalControls} controls compliant
        </p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-xs text-stone-600 dark:text-stone-400"
        >
          {totalControls - compliantControls} controls need attention
        </motion.p>
      </div>
    </motion.div>
  );
}
