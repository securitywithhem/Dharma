"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import Link from "next/link";
import { X, AlertTriangle } from "lucide-react";

export function UpgradeBannerHeader() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  const { usageStats } = useEntitlements();

  // Dismiss banner after success
  useEffect(() => {
    if (searchParams?.get("success")) {
      setDismissed(true);
    }
  }, [searchParams]);

  if (dismissed || !usageStats) return null;

  // Show banner if on free plan and any resource is at 50%+ usage
  const isAtCapacity =
    (usageStats.users.percent >= 50) ||
    (usageStats.frameworks.percent >= 50) ||
    (usageStats.storage.percent >= 50);

  // Don't show for enterprise
  if (!isAtCapacity || usageStats.planName === "enterprise") return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20 px-4 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-4 max-w-7xl mx-auto">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-500 w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-400">
              You're reaching your plan limits
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
              Upgrade to unlock more users, frameworks, and storage.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={"/dashboard/settings/billing?tab=plans" as any}
            className="text-sm font-semibold text-amber-900 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 underline underline-offset-2"
          >
            Upgrade
          </Link>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="text-amber-600 hover:text-amber-700 dark:text-amber-500 dark:hover:text-amber-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
