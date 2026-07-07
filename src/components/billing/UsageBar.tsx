import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils";

interface UsageBarProps {
  label: string;
  current: number;
  limit: number;
  percent: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
  format?: 'number' | 'bytes';
}

export function UsageBar({
  label,
  current,
  limit,
  percent,
  isNearLimit,
  isOverLimit,
  format = 'number',
}: UsageBarProps) {
  const displayCurrent = format === 'bytes' ? formatBytes(current * 1024 * 1024) : current;
  const displayLimit = limit === 0 ? 'Unlimited' : (format === 'bytes' ? formatBytes(limit * 1024 * 1024) : limit);

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {displayCurrent} / {displayLimit}
        </span>
      </div>
      <Progress
        value={limit === 0 ? 0 : Math.min(percent, 100)}
        className={cn(
          "h-2",
          isOverLimit
            ? "[&>div]:bg-destructive"
            : isNearLimit
            ? "[&>div]:bg-amber-500"
            : "[&>div]:bg-primary"
        )}
      />
      {isOverLimit && limit !== 0 && (
        <p className="text-xs text-destructive mt-1">
          Limit exceeded. Please upgrade your plan.
        </p>
      )}
      {isNearLimit && !isOverLimit && limit !== 0 && (
        <p className="text-xs text-amber-500 mt-1">
          Nearing limit. Consider upgrading soon.
        </p>
      )}
    </div>
  );
}
