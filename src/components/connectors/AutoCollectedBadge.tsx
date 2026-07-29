import React from "react";

interface AutoCollectedBadgeProps {
  source?: string;
  className?: string;
}

export function AutoCollectedBadge({
  source,
  className = "",
}: AutoCollectedBadgeProps) {
  if (source !== "auto") return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-dharma-accent-tint text-dharma-accent-on-tint rounded-full border border-dharma-accent ${className}`}
    >
      <span className="w-1.5 h-1.5 bg-dharma-info-bg rounded-full"></span>
      Auto-collected
    </span>
  );
}
