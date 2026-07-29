import React, { useState } from "react";
import { useEvidenceMapping } from "@/lib/hooks/useEvidenceMapping";

interface CollectNowButtonProps {
  mappingId: string;
  disabled?: boolean;
}

export function CollectNowButton({
  mappingId,
  disabled = false,
}: CollectNowButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { triggerNowMutation } = useEvidenceMapping();

  const handleCollectNow = async () => {
    setIsLoading(true);
    try {
      await triggerNowMutation.mutateAsync({ id: mappingId });
    } catch (error) {
      console.error("Failed to trigger evidence collection:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleCollectNow}
      disabled={disabled || isLoading}
      className="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium bg-dharma-accent text-dharma-ink-inverse hover:bg-dharma-accent-hover rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Trigger immediate evidence collection for this mapping"
    >
      {isLoading ? (
        <>
          <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          Collecting...
        </>
      ) : (
        <>
          <span>⚡</span>
          Collect Now
        </>
      )}
    </button>
  );
}
