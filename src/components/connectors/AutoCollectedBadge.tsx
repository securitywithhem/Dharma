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
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full border border-blue-200 ${className}`}
    >
      <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
      Auto-collected
    </span>
  );
}
