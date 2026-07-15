// Phase 9 Part 3 — framework version diff engine.
//
// Plain structural tree diff between two controlsSnapshot payloads — NOT
// routed through Graphify/LLM: this is deterministic set/field comparison,
// where a graph tool adds cost and non-determinism with no benefit (the
// brief explicitly cautions against over-engineering here).
//
// A snapshot is an array of control objects keyed by a stable identifier
// (`code` if present, else `id`); each control carries at least
// { title, description } for field-level modification detection.

export interface SnapshotControl {
  id?: string;
  code?: string;
  title?: string;
  description?: string;
  domain?: string;
  [k: string]: unknown;
}

export interface ControlDiffEntry {
  key: string;
  title: string;
}

export interface ModifiedControlDiff {
  key: string;
  title: string;
  /** Which comparable fields changed (title/description/domain). */
  changedFields: string[];
}

export interface FrameworkDiff {
  added: ControlDiffEntry[];
  removed: ControlDiffEntry[];
  modified: ModifiedControlDiff[];
}

/** Stable key for a control within a snapshot: prefer `code`, fall back to `id`. */
function controlKey(control: SnapshotControl): string | null {
  if (typeof control.code === "string" && control.code.length > 0) return control.code;
  if (typeof control.id === "string" && control.id.length > 0) return control.id;
  return null;
}

/** Coerces an arbitrary Json snapshot into a control array (tolerant of shapes). */
export function normalizeSnapshot(snapshot: unknown): SnapshotControl[] {
  if (Array.isArray(snapshot)) return snapshot as SnapshotControl[];
  if (snapshot && typeof snapshot === "object") {
    const maybeControls = (snapshot as { controls?: unknown }).controls;
    if (Array.isArray(maybeControls)) return maybeControls as SnapshotControl[];
  }
  return [];
}

const COMPARED_FIELDS: (keyof SnapshotControl)[] = ["title", "description", "domain"];

/**
 * Computes { added, removed, modified } between an OLD and a NEW snapshot.
 * - added: keys present in new but not old
 * - removed: keys present in old but not new
 * - modified: keys in both whose compared fields differ
 * Controls without a usable key are ignored (can't be tracked across versions).
 */
export function diffControlSnapshots(
  oldSnapshot: unknown,
  newSnapshot: unknown,
): FrameworkDiff {
  const oldControls = normalizeSnapshot(oldSnapshot);
  const newControls = normalizeSnapshot(newSnapshot);

  const oldByKey = new Map<string, SnapshotControl>();
  for (const c of oldControls) {
    const k = controlKey(c);
    if (k) oldByKey.set(k, c);
  }
  const newByKey = new Map<string, SnapshotControl>();
  for (const c of newControls) {
    const k = controlKey(c);
    if (k) newByKey.set(k, c);
  }

  const added: ControlDiffEntry[] = [];
  const removed: ControlDiffEntry[] = [];
  const modified: ModifiedControlDiff[] = [];

  for (const [key, control] of newByKey) {
    if (!oldByKey.has(key)) {
      added.push({ key, title: String(control.title ?? key) });
    }
  }
  for (const [key, control] of oldByKey) {
    if (!newByKey.has(key)) {
      removed.push({ key, title: String(control.title ?? key) });
    }
  }
  for (const [key, newControl] of newByKey) {
    const oldControl = oldByKey.get(key);
    if (!oldControl) continue;
    const changedFields = COMPARED_FIELDS.filter(
      (f) => (oldControl[f] ?? null) !== (newControl[f] ?? null),
    ).map(String);
    if (changedFields.length > 0) {
      modified.push({ key, title: String(newControl.title ?? key), changedFields });
    }
  }

  // Deterministic ordering so the stored diff (and any test snapshot) is stable.
  const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
  added.sort(byKey);
  removed.sort(byKey);
  modified.sort(byKey);

  return { added, removed, modified };
}

export function isEmptyDiff(diff: FrameworkDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0;
}
