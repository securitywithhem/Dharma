"use client";

import { useState } from "react";
import type { ControlStatus } from "@prisma/client";
import { FileText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ControlDetailModal } from "./ControlDetailModal";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface ControlRow {
  id: string;
  domain: string;
  title: string;
  description: string;
  status: ControlStatus;
  evidenceCount: number;
  guidance?: string;
}

interface ControlTableProps {
  controls: ControlRow[];
  onStatusChanged?: () => void;
}

// ------------------------------------------------------------------
// Status config
// ------------------------------------------------------------------

const STATUS_CONFIG: Record<
  ControlStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "success" | "warning"; className: string }
> = {
  NOT_STARTED: {
    label: "Not Started",
    variant: "outline",
    className: "border-border text-muted-foreground",
  },
  IN_PROGRESS: {
    label: "In Progress",
    variant: "warning",
    className: "",
  },
  COMPLIANT: {
    label: "Compliant",
    variant: "success",
    className: "",
  },
  NOT_APPLICABLE: {
    label: "N/A",
    variant: "secondary",
    className: "opacity-60",
  },
};

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function ControlTable({ controls, onStatusChanged }: ControlTableProps) {
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [filterDomain, setFilterDomain] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const domains = Array.from(new Set(controls.map((c) => c.domain))).sort();

  const filteredControls = controls.filter((c) => {
    const matchesDomain = !filterDomain || c.domain === filterDomain;
    const matchesSearch =
      !searchQuery ||
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.domain.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDomain && matchesSearch;
  });

  const selectedControl = controls.find((c) => c.id === selectedControlId);

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search controls…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 w-full sm:w-64"
            aria-label="Search controls"
          />
        </div>

        {/* Domain filters */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by domain">
          <Button
            variant={filterDomain === "" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterDomain("")}
            className="text-xs h-8"
          >
            All ({controls.length})
          </Button>
          {domains.map((domain) => {
            const count = controls.filter((c) => c.domain === domain).length;
            return (
              <Button
                key={domain}
                variant={filterDomain === domain ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterDomain(domain)}
                className="text-xs h-8 max-w-[160px] truncate"
                title={domain}
              >
                {domain.split(" ").slice(0, 2).join(" ")} ({count})
              </Button>
            );
          })}
        </div>
      </div>

      {/* Result count */}
      {searchQuery && (
        <p className="text-xs text-muted-foreground mb-3">
          Showing {filteredControls.length} of {controls.length} controls
        </p>
      )}

      {filteredControls.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground rounded-lg border border-dashed border-border">
          No controls match your filter.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Domain</TableHead>
              <TableHead>Control</TableHead>
              <TableHead className="w-[130px]">Status</TableHead>
              <TableHead className="w-[100px]">Evidence</TableHead>
              <TableHead className="w-[80px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredControls.map((control) => {
              const status = STATUS_CONFIG[control.status];
              return (
                <TableRow
                  key={control.id}
                  className={cn(
                    "cursor-pointer",
                    control.status === "COMPLIANT" && "bg-emerald-500/5",
                    control.status === "NOT_APPLICABLE" && "opacity-60",
                  )}
                  onClick={() => setSelectedControlId(control.id)}
                >
                  <TableCell>
                    <span className="text-xs font-medium text-muted-foreground">
                      {control.domain}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium text-sm leading-tight">
                      {control.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {control.description}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={status.variant}
                      className={cn("text-xs", status.className)}
                    >
                      {status.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      <span>{control.evidenceCount}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      aria-label={`View details for ${control.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedControlId(control.id);
                      }}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Detail modal */}
      {selectedControlId && selectedControl && (
        <ControlDetailModal
          controlId={selectedControlId}
          onClose={() => setSelectedControlId(null)}
          onStatusChanged={() => {
            setSelectedControlId(null);
            onStatusChanged?.();
          }}
        />
      )}
    </>
  );
}
