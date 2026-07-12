"use client";

import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import {
  ChevronRight,
  FileText,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { controlTypeForDepth, type TreeControl } from "./treeUtils";

const STATUS_META: Record<
  TreeControl["status"],
  { label: string; variant: "outline" | "secondary" | "success" | "warning"; className: string }
> = {
  NOT_STARTED: { label: "Not Started", variant: "outline", className: "border-border text-muted-foreground" },
  IN_PROGRESS: { label: "In Progress", variant: "warning", className: "" },
  COMPLIANT: { label: "Compliant", variant: "success", className: "" },
  NOT_APPLICABLE: { label: "N/A", variant: "secondary", className: "opacity-60" },
};

const INDENT = 24; // px per depth level

interface ControlTreeNodeProps {
  node: TreeControl;
  collapsed: Set<string>;
  focusedId: string | null;
  activeId: string | null;
  projectedDepth: number | null;
  disabled: boolean;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (node: TreeControl) => void;
  onFocus: (id: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

export function ControlTreeNode(props: ControlTreeNodeProps) {
  const { node, collapsed, activeId, projectedDepth, focusedId } = props;
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.id, disabled: props.disabled });

  // While the active node is being dragged, preview it at the projected depth.
  const effectiveDepth =
    activeId === node.id && projectedDepth != null ? projectedDepth : node.depth;

  const type = controlTypeForDepth(effectiveDepth);
  const status = STATUS_META[node.status];
  const isFocused = focusedId === node.id;

  return (
    <>
      <div
        ref={setNodeRef}
        style={{
          transform: CSS.Translate.toString(transform),
          transition,
          paddingLeft: effectiveDepth * INDENT + 4,
        }}
        className={cn("relative", isDragging && "opacity-50")}
      >
        <div
          ref={(el) => props.registerRef(node.id, el)}
          role="treeitem"
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          aria-level={effectiveDepth + 1}
          aria-label={`${type.label}: ${node.title}`}
          tabIndex={isFocused ? 0 : -1}
          onFocus={() => props.onFocus(node.id)}
          className={cn(
            "group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 outline-none",
            "hover:bg-muted/50 focus-visible:border-primary/50 focus-visible:bg-muted/50",
            isFocused && "bg-muted/40",
          )}
        >
          {/* Drag handle */}
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${node.title}`}
            tabIndex={-1}
            className="shrink-0 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {/* Expand / collapse */}
          {hasChildren ? (
            <button
              onClick={() => props.onToggle(node.id)}
              aria-label={isCollapsed ? "Expand" : "Collapse"}
              tabIndex={-1}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <ChevronRight
                className={cn("h-4 w-4 transition-transform", !isCollapsed && "rotate-90")}
              />
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden />
          )}

          {/* Type badge */}
          <Badge variant="outline" className={cn("shrink-0 text-[10px] font-medium", type.className)}>
            {type.label}
          </Badge>

          {/* Code + title */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              {node.code && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{node.code}</span>
              )}
              <span className="truncate text-sm font-medium">{node.title}</span>
            </div>
            {node.description && (
              <p className="truncate text-xs text-muted-foreground">{node.description}</p>
            )}
          </div>

          {/* Status */}
          <Badge variant={status.variant} className={cn("shrink-0 text-[10px]", status.className)}>
            {status.label}
          </Badge>

          {/* Evidence count */}
          <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
            <FileText className="h-3.5 w-3.5" />
            {node.evidenceCount}
          </span>

          {/* Row actions (reveal on hover/focus) */}
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              onClick={() => props.onAddChild(node.id)}
              disabled={props.disabled}
              aria-label={`Add sub-control under ${node.title}`}
              className="rounded p-1 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-500 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => props.onDelete(node)}
              disabled={props.disabled}
              aria-label={`Delete ${node.title}`}
              className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Recurse into children */}
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child) => (
          <ControlTreeNode key={child.id} {...props} node={child} />
        ))}
    </>
  );
}

export { INDENT };
