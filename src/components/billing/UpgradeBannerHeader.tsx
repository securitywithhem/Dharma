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
    <div className="bg-dharma-warning-bg border-b border-dharma-warning px-4 py-3 sm:px-5 lg:px-6">
      {/* max-w-[88rem] and the shell's padding, not Tailwind's max-w-7xl (1280px)
          with sm:px-6. The banner sits in the chrome above <main>, so if its rail
          does not match the page container exactly its left edge misaligns with
          the page heading beneath it — visible on any screen wider than 1280px. */}
      <div className="mx-auto flex max-w-[88rem] items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="text-dharma-ink w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-dharma-ink">
              You're reaching your plan limits
            </p>
            <p className="text-xs text-dharma-ink mt-1">
              Upgrade to unlock more users, frameworks, and storage.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href={"/dashboard/settings/billing?tab=plans" as any}
            className="text-sm font-semibold text-dharma-ink hover:text-dharma-ink underline underline-offset-2"
          >
            Upgrade
          </Link>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="text-dharma-ink hover:text-dharma-ink transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
