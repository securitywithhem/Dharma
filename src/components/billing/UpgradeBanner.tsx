import { AlertTriangle, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

export function UpgradeBanner() {
  const router = useRouter();
  const { usageStats } = useEntitlements();

  if (!usageStats) return null;

  const isOverLimit =
    usageStats.users.isOverLimit ||
    usageStats.frameworks.isOverLimit ||
    usageStats.storage.isOverLimit;

  const isNearLimit =
    usageStats.users.isNearLimit ||
    usageStats.frameworks.isNearLimit ||
    usageStats.storage.isNearLimit;

  if (!isOverLimit && !isNearLimit) return null;

  return (
    <div
      className={`rounded-lg p-4 flex items-center justify-between shadow-sm mb-6 ${
        isOverLimit
          ? "bg-destructive/10 text-destructive border border-destructive/20"
          : "bg-amber-500/10 text-amber-700 border border-amber-500/20 dark:text-amber-400"
      }`}
    >
      <div className="flex items-center gap-3">
        {isOverLimit ? (
          <AlertTriangle className="h-5 w-5 shrink-0" />
        ) : (
          <Rocket className="h-5 w-5 shrink-0" />
        )}
        <div className="text-sm">
          <p className="font-semibold">
            {isOverLimit
              ? "You've reached a plan limit"
              : "You're nearing a plan limit"}
          </p>
          <p className="opacity-90 mt-0.5">
            {isOverLimit
              ? "Certain features may be disabled until you upgrade your plan or reduce usage."
              : "Upgrade your plan soon to avoid any disruptions to your workflow."}
          </p>
        </div>
      </div>
      <Button
        variant={isOverLimit ? "destructive" : "default"}
        size="sm"
        onClick={() => router.push("/dashboard/settings/billing" as any)}
      >
        Upgrade Plan
      </Button>
    </div>
  );
}
