"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpDown, ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FamilyBreakdown } from "@/server/services/readinessScoring";

interface FamilyBreakdownTableProps {
  frameworkId: string;
  families: FamilyBreakdown[];
}

type SortKey = "familyName" | "familyScore" | "evidencedLeaves";

function barClass(score: number): string {
  if (score < 50) return "[&>div]:bg-dharma-danger-bg";
  if (score < 75) return "[&>div]:bg-dharma-warning-bg";
  return "[&>div]:bg-dharma-success-bg";
}

export function FamilyBreakdownTable({ frameworkId, families }: FamilyBreakdownTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("familyScore");
  const [sortAsc, setSortAsc] = useState(true);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((a) => !a);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sorted = [...families].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    if (sortKey === "familyName") return a.familyName.localeCompare(b.familyName) * dir;
    if (sortKey === "evidencedLeaves") return (a.evidencedLeaves - b.evidencedLeaves) * dir;
    return (a.familyScore - b.familyScore) * dir;
  });

  const SortButton = ({ column, label }: { column: SortKey; label: string }) => (
    <button
      onClick={() => toggleSort(column)}
      className={cn(
        "flex items-center gap-1 text-xs font-medium hover:text-dharma-ink",
        sortKey === column ? "text-dharma-ink" : "text-dharma-ink-secondary",
      )}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  if (families.length === 0) {
    return <p className="py-8 text-center text-sm text-dharma-ink-secondary">No control families to show yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SortButton column="familyName" label="Family" />
          </TableHead>
          <TableHead className="w-[160px]">
            <SortButton column="evidencedLeaves" label="Controls" />
          </TableHead>
          <TableHead className="w-[240px]">
            <SortButton column="familyScore" label="Coverage" />
          </TableHead>
          <TableHead className="w-[60px]">
            <span className="sr-only">View</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((f) => (
          <TableRow key={f.familyId}>
            <TableCell className="font-medium text-sm">{f.familyName}</TableCell>
            <TableCell className="text-sm text-dharma-ink-secondary">
              {f.evidencedLeaves} / {f.totalLeaves}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Progress value={f.familyScore} className={cn("h-2 flex-1", barClass(f.familyScore))} />
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-dharma-ink-secondary">
                  {Math.round(f.familyScore)}%
                </span>
              </div>
            </TableCell>
            <TableCell>
              <Link
                href={`/dashboard/frameworks/${frameworkId}` as Route}
                aria-label={`View ${f.familyName} controls`}
                className="inline-flex"
              >
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
