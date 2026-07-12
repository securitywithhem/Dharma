import type { ControlStatus } from "@prisma/client";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

// ------------------------------------------------------------------
// Types — shape mirrors control.getTree output
// ------------------------------------------------------------------

export interface TreeControl {
  id: string;
  frameworkId: string;
  parentId: string | null;
  code?: string;
  domain: string;
  title: string;
  description: string;
  guidance?: string;
  status: ControlStatus;
  depth: number;
  sortOrder: number;
  evidenceCount: number;
  children: TreeControl[];
}

export interface FlattenedControl extends Omit<TreeControl, "children"> {
  /** Number of direct + indirect descendants (for collapse affordances). */
  childCount: number;
  /** True when this node has at least one child. */
  hasChildren: boolean;
}

// ------------------------------------------------------------------
// Flatten / rebuild
// ------------------------------------------------------------------

/**
 * Depth-first flatten of the tree into the visible row order. Children of a
 * collapsed node are omitted. `depth` is recomputed from position so it stays
 * consistent during an in-flight optimistic drag.
 */
export function flattenTree(
  roots: TreeControl[],
  collapsedIds: Set<string>,
): FlattenedControl[] {
  const out: FlattenedControl[] = [];
  const walk = (nodes: TreeControl[], depth: number) => {
    for (const node of nodes) {
      out.push({
        id: node.id,
        frameworkId: node.frameworkId,
        parentId: node.parentId,
        code: node.code,
        domain: node.domain,
        title: node.title,
        description: node.description,
        guidance: node.guidance,
        status: node.status,
        depth,
        sortOrder: node.sortOrder,
        evidenceCount: node.evidenceCount,
        childCount: countDescendants(node),
        hasChildren: node.children.length > 0,
      });
      if (node.children.length > 0 && !collapsedIds.has(node.id)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(roots, 0);
  return out;
}

/** Total number of descendants (direct + indirect) beneath a node. */
export function countDescendants(node: TreeControl): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

/** Rebuild a nested tree from a flat, ordered list using each row's parentId/depth. */
export function buildTree(flat: FlattenedControl[]): TreeControl[] {
  const roots: TreeControl[] = [];
  const byId = new Map<string, TreeControl>();
  for (const item of flat) {
    byId.set(item.id, { ...item, children: [] });
  }
  for (const item of flat) {
    const node = byId.get(item.id)!;
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

// ------------------------------------------------------------------
// Drag projection — adapted from the dnd-kit sortable-tree example (MIT)
// ------------------------------------------------------------------

export interface Projection {
  depth: number;
  parentId: string | null;
}

/**
 * Given the active/over positions and the horizontal drag offset, project which
 * depth and parent the dragged node would land at. Horizontal movement changes
 * depth (and therefore parent); vertical movement changes order.
 */
export function getProjection(
  items: FlattenedControl[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier,
  dragOffsetX: number,
  indentationWidth: number,
): Projection {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const activeItem = items[activeIndex];
  const newItems = arrayMove(items, activeIndex, overIndex);
  const previous = newItems[overIndex - 1];
  const next = newItems[overIndex + 1];

  const dragDepth = Math.round(dragOffsetX / indentationWidth);
  const projectedDepth = (activeItem?.depth ?? 0) + dragDepth;

  const maxDepth = previous ? previous.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.max(minDepth, Math.min(projectedDepth, maxDepth));

  let parentId: string | null = null;
  if (depth !== 0 && previous) {
    if (depth === previous.depth) {
      parentId = previous.parentId;
    } else if (depth > previous.depth) {
      parentId = previous.id;
    } else {
      // Walk back to the nearest ancestor at the target depth.
      const ancestor = newItems
        .slice(0, overIndex)
        .reverse()
        .find((i) => i.depth === depth);
      parentId = ancestor?.parentId ?? null;
    }
  }

  return { depth, parentId };
}

// ------------------------------------------------------------------
// Sibling ordering helper
// ------------------------------------------------------------------

/**
 * After a drop, produce the ordered list of sibling ids under `parentId` given
 * the dragged item's new position within the flattened array. Used to drive the
 * `reorder` mutation.
 */
export function orderedSiblingIds(
  flat: FlattenedControl[],
  parentId: string | null,
): string[] {
  return flat.filter((i) => i.parentId === parentId).map((i) => i.id);
}

/** All descendant ids of `id` in the flattened list (for collapse-drag hygiene). */
export function descendantIds(flat: FlattenedControl[], id: string): string[] {
  const index = flat.findIndex((i) => i.id === id);
  if (index === -1) return [];
  const rootDepth = flat[index].depth;
  const out: string[] = [];
  for (let i = index + 1; i < flat.length; i++) {
    if (flat[i].depth <= rootDepth) break;
    out.push(flat[i].id);
  }
  return out;
}

/** Human label + accent for a control's role, inferred from its depth. */
export function controlTypeForDepth(depth: number): {
  label: string;
  className: string;
} {
  if (depth === 0)
    return {
      label: "Family",
      className: "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/5",
    };
  if (depth === 1)
    return {
      label: "Control",
      className:
        "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5",
    };
  return {
    label: "Enhancement",
    className: "border-border text-muted-foreground",
  };
}
