"use client";

import { useState } from "react";
import { ChevronRight, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { controlTypeForDepth, type TreeControl } from "@/components/controls/treeUtils";

const INDENT = 20;

interface MappableControlTreeProps {
  roots: TreeControl[];
  /** Control ids that already have at least one cross-walk mapping. */
  mappedIds: Set<string>;
  selectedId: string | null;
  onSelect: (control: TreeControl) => void;
}

/**
 * Read-only, selectable variant of Part 1's control tree for the cross-walk
 * picker. Deliberately not an extension of ControlTree.tsx: that component's
 * rows are wired to dnd-kit's useSortable, which requires a DndContext
 * ancestor — forcing that scaffolding into a non-drag, read-only selection
 * list would add complexity without benefit. This shares the same tree shape
 * and controlTypeForDepth() badge convention from Part 1's treeUtils instead.
 */
export function MappableControlTree({ roots, mappedIds, selectedId, onSelect }: MappableControlTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: TreeControl, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const type = controlTypeForDepth(depth);
    const isSelected = selectedId === node.id;
    const isMapped = mappedIds.has(node.id);

    return (
      <div key={node.id}>
        <div
          role="treeitem"
          aria-selected={isSelected}
          style={{ paddingLeft: depth * INDENT + 4 }}
          onClick={() => onSelect(node)}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50",
            isSelected && "bg-primary/10 ring-1 ring-primary/40",
          )}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
              aria-label={isCollapsed ? "Expand" : "Collapse"}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !isCollapsed && "rotate-90")} />
            </button>
          ) : (
            <span className="w-4 shrink-0" aria-hidden />
          )}

          <Badge variant="outline" className={cn("shrink-0 text-[9px] font-medium", type.className)}>
            {type.label}
          </Badge>

          <span className="min-w-0 flex-1 truncate text-sm">
            {node.code && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{node.code}</span>}
            {node.title}
          </span>

          {isMapped && (
            <Link2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Has existing mapping(s)" />
          )}
        </div>

        {hasChildren && !isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  if (roots.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No controls in this framework yet.</p>;
  }

  return (
    <div role="tree" className="max-h-[480px] overflow-y-auto pr-1">
      {roots.map((node) => renderNode(node, 0))}
    </div>
  );
}
