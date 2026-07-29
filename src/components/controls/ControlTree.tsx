"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ListTree, Plus, X } from "lucide-react";
import { api } from "@/hooks/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ControlTreeNode, INDENT } from "./ControlTreeNode";
import {
  buildTree,
  countDescendants,
  flattenTree,
  getProjection,
  orderedSiblingIds,
  type TreeControl,
} from "./treeUtils";

interface ControlTreeProps {
  frameworkId: string;
}

interface AddTarget {
  parentId: string | null;
  parentTitle: string | null;
}

export function ControlTree({ frameworkId }: ControlTreeProps) {
  const utils = api.useUtils();
  const { data, isLoading, isError, error } = api.control.getTree.useQuery({ frameworkId });

  // Optimistic override of the server tree; cleared whenever fresh server data lands.
  const [override, setOverride] = useState<TreeControl[] | null>(null);
  const serverRoots = useMemo(() => (data?.roots ?? []) as unknown as TreeControl[], [data]);
  useEffect(() => setOverride(null), [data]);
  const roots = override ?? serverRoots;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  const [overId, setOverId] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);

  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const flattened = useMemo(() => flattenTree(roots, collapsed), [roots, collapsed]);

  const rollback = useCallback(() => {
    setOverride(null);
    void utils.control.getTree.invalidate({ frameworkId });
  }, [utils, frameworkId]);

  const moveMutation = api.control.move.useMutation({ onError: rollback });
  const reorderMutation = api.control.reorder.useMutation({ onError: rollback });
  const deleteMutation = api.control.delete.useMutation();
  const createMutation = api.control.createChild.useMutation();

  const mutating =
    moveMutation.isPending || reorderMutation.isPending || createMutation.isPending || deleteMutation.isPending;

  // ---------------------------------------------------------------
  // Drag handlers
  // ---------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setOverId(String(active.id));
    // Collapse the dragged node's subtree so descendants travel with it cleanly.
    setCollapsed((prev) => new Set(prev).add(String(active.id)));
  };

  const handleDragMove = ({ delta, over }: DragMoveEvent) => {
    setOffsetLeft(delta.x);
    if (over) setOverId(String(over.id));
  };

  const projection =
    activeId && overId
      ? getProjection(flattened, activeId, overId, offsetLeft, INDENT)
      : null;

  const resetDrag = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetLeft(0);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    const proj = activeId && overId ? getProjection(flattened, active.id, over?.id ?? active.id, offsetLeft, INDENT) : null;
    resetDrag();
    if (!over || !proj) return;

    const activeItem = flattened.find((i) => i.id === active.id);
    if (!activeItem) return;

    const activeIndex = flattened.findIndex((i) => i.id === active.id);
    const overIndex = flattened.findIndex((i) => i.id === over.id);
    const newFlat = arrayMove(flattened, activeIndex, overIndex).map((i) =>
      i.id === active.id ? { ...i, parentId: proj.parentId, depth: proj.depth } : i,
    );

    const oldParentId = activeItem.parentId;
    const newParentId = proj.parentId;

    // No structural change → nothing to do.
    if (newParentId === oldParentId && activeIndex === overIndex) return;

    // Optimistic apply.
    setOverride(buildTree(newFlat));

    try {
      if (newParentId !== oldParentId) {
        await moveMutation.mutateAsync({ controlId: String(active.id), newParentId });
      }
      const siblings = orderedSiblingIds(newFlat, newParentId);
      if (siblings.length > 1) {
        await reorderMutation.mutateAsync({ frameworkId, parentId: newParentId, orderedControlIds: siblings });
      }
      await utils.control.getTree.invalidate({ frameworkId });
    } catch {
      // onError handlers already rolled back.
    }
  };

  // ---------------------------------------------------------------
  // Keyboard navigation (roving tabindex over visible rows)
  // ---------------------------------------------------------------
  const focusRow = useCallback((id: string | null) => {
    if (!id) return;
    setFocusedId(id);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }, []);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!focusedId) return;
    const index = flattened.findIndex((i) => i.id === focusedId);
    if (index === -1) return;
    const item = flattened[index];

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(flattened[Math.min(index + 1, flattened.length - 1)]?.id ?? null);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(flattened[Math.max(index - 1, 0)]?.id ?? null);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (item.hasChildren && collapsed.has(item.id)) toggle(item.id);
        else if (item.hasChildren) focusRow(flattened[index + 1]?.id ?? null);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (item.hasChildren && !collapsed.has(item.id)) toggle(item.id);
        else if (item.parentId) focusRow(item.parentId);
        break;
      case "Enter":
      case " ":
        if (item.hasChildren) {
          e.preventDefault();
          toggle(item.id);
        }
        break;
    }
  };

  // ---------------------------------------------------------------
  // Add / delete
  // ---------------------------------------------------------------
  const openAdd = useCallback(
    (parentId: string | null) => {
      const parentTitle = parentId ? flattened.find((i) => i.id === parentId)?.title ?? null : null;
      setAddTarget({ parentId, parentTitle });
    },
    [flattened],
  );

  const handleDelete = useCallback(
    async (node: TreeControl) => {
      const hasKids = node.children.length > 0;
      const message = hasKids
        ? `Delete "${node.title}" and all ${countDescendants(node)} descendant control(s)? This cannot be undone.`
        : `Delete "${node.title}"? This cannot be undone.`;
      if (!window.confirm(message)) return;
      try {
        await deleteMutation.mutateAsync({ controlId: node.id, cascade: hasKids });
      } finally {
        await utils.control.getTree.invalidate({ frameworkId });
      }
    },
    [deleteMutation, utils, frameworkId, flattened],
  );

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" style={{ marginLeft: (i % 3) * INDENT }} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-dashed border-dharma-danger py-10 text-center text-sm text-dharma-danger-text">
        {error?.message ?? "Failed to load the control hierarchy."}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs text-dharma-ink-secondary">
          <ListTree className="h-3.5 w-3.5" />
          Drag to reorder or re-parent · arrow keys to navigate
        </p>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openAdd(null)} disabled={mutating}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add root control
        </Button>
      </div>

      {addTarget && (
        <AddControlForm
          target={addTarget}
          disabled={createMutation.isPending}
          onCancel={() => setAddTarget(null)}
          onSubmit={async (values) => {
            await createMutation.mutateAsync({
              frameworkId,
              parentId: addTarget.parentId,
              title: values.title,
              description: values.description || values.title,
              code: values.code || undefined,
              domain: addTarget.parentId ? undefined : values.domain || "General",
            });
            setAddTarget(null);
            await utils.control.getTree.invalidate({ frameworkId });
          }}
        />
      )}

      {roots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-dharma-border py-12 text-center">
          <ListTree className="mx-auto h-8 w-8 text-dharma-ink-secondary" />
          <p className="mt-3 text-sm font-medium">No controls yet</p>
          <p className="mt-1 text-xs text-dharma-ink-secondary">
            Add a root control to start building this framework&apos;s hierarchy.
          </p>
          <Button variant="outline" size="sm" className="mt-4 h-8 text-xs" onClick={() => openAdd(null)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add root control
          </Button>
        </div>
      ) : (
        <div
          role="tree"
          aria-label="Control hierarchy"
          onKeyDown={handleKeyDown}
          className={cn("select-none", mutating && "pointer-events-none opacity-70")}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={resetDrag}
          >
            <SortableContext items={flattened.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {roots.map((node) => (
                <ControlTreeNode
                  key={node.id}
                  node={node}
                  collapsed={collapsed}
                  focusedId={focusedId}
                  activeId={activeId}
                  projectedDepth={projection?.depth ?? null}
                  disabled={mutating}
                  onToggle={toggle}
                  onAddChild={openAdd}
                  onDelete={handleDelete}
                  onFocus={setFocusedId}
                  registerRef={registerRef}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Inline add-control form
// ------------------------------------------------------------------

interface AddFormValues {
  title: string;
  description: string;
  code: string;
  domain: string;
}

function AddControlForm({
  target,
  disabled,
  onSubmit,
  onCancel,
}: {
  target: AddTarget;
  disabled: boolean;
  onSubmit: (values: AddFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<AddFormValues>({ title: "", description: "", code: "", domain: "" });
  const isRoot = target.parentId === null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (values.title.trim()) void onSubmit(values);
      }}
      className="mb-3 rounded-lg border border-dharma-success bg-dharma-success-bg p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium">
          {isRoot ? "New root control" : `New sub-control under “${target.parentTitle}”`}
        </p>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="text-dharma-ink-secondary hover:text-dharma-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          autoFocus
          placeholder="Title *"
          value={values.title}
          onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
          className="h-8 flex-1 min-w-[180px] text-sm"
          aria-label="Control title"
        />
        <Input
          placeholder="Code (e.g. AC-2)"
          value={values.code}
          onChange={(e) => setValues((v) => ({ ...v, code: e.target.value }))}
          className="h-8 w-32 text-sm"
          aria-label="Control code"
        />
        {isRoot && (
          <Input
            placeholder="Domain"
            value={values.domain}
            onChange={(e) => setValues((v) => ({ ...v, domain: e.target.value }))}
            className="h-8 w-40 text-sm"
            aria-label="Control domain"
          />
        )}
      </div>
      <Input
        placeholder="Description (optional)"
        value={values.description}
        onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
        className="mt-2 h-8 text-sm"
        aria-label="Control description"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={disabled || !values.title.trim()}>
          {disabled ? "Adding…" : "Add control"}
        </Button>
      </div>
    </form>
  );
}
