"use client";

import { ArrowLeftRight } from "lucide-react";
import { api } from "@/hooks/trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface FrameworkPairSelectorProps {
  frameworkAId: string | null;
  frameworkBId: string | null;
  onChange: (next: { frameworkAId: string | null; frameworkBId: string | null }) => void;
}

export function FrameworkPairSelector({ frameworkAId, frameworkBId, onChange }: FrameworkPairSelectorProps) {
  const { data: frameworks, isLoading } = api.framework.list.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-56" />
      </div>
    );
  }

  const options = frameworks ?? [];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={frameworkAId ?? undefined}
        onValueChange={(v) => onChange({ frameworkAId: v, frameworkBId })}
      >
        <SelectTrigger className="h-9 w-56">
          <SelectValue placeholder="Framework A" />
        </SelectTrigger>
        <SelectContent>
          {options
            .filter((fw) => fw.id !== frameworkBId)
            .map((fw) => (
              <SelectItem key={fw.id} value={fw.id}>
                {fw.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <ArrowLeftRight className="h-4 w-4 shrink-0 text-dharma-ink-secondary" aria-hidden />

      <Select
        value={frameworkBId ?? undefined}
        onValueChange={(v) => onChange({ frameworkAId, frameworkBId: v })}
      >
        <SelectTrigger className="h-9 w-56">
          <SelectValue placeholder="Framework B" />
        </SelectTrigger>
        <SelectContent>
          {options
            .filter((fw) => fw.id !== frameworkAId)
            .map((fw) => (
              <SelectItem key={fw.id} value={fw.id}>
                {fw.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
