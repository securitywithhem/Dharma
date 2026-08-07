/**
 * GH #24 — destructive actions must be confirmed in the UI and audited on the
 * server.
 *
 * These are STATIC checks over the source tree, deliberately, and the choice is
 * worth defending: the property under test is "no delete path anywhere is
 * missing a confirmation or an audit write". A behavioural test proves that for
 * the handful of paths someone remembered to write a test for — which is
 * exactly the failure mode the issue describes, since the two paths in the QA
 * report were not special, just the two that happened to be clicked. A static
 * sweep covers paths that do not exist yet.
 *
 * Both checks are verified to FAIL when a real call site is reverted; see the
 * fix log entry for GH #24.
 */
import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function rel(path: string) {
  return path.slice(ROOT.length + 1);
}

// ---------------------------------------------------------------------------
// Server: every delete writes to the audit log
// ---------------------------------------------------------------------------

describe("every destructive server mutation writes an AuditLog entry", () => {
  const routerFiles = walk(join(ROOT, "src", "server", "routers"));

  /**
   * Split a router file into procedure bodies keyed by procedure name, so a
   * delete in one mutation cannot be "covered" by an audit write in a
   * completely different one further down the file — which is precisely what a
   * whole-file grep would have wrongly accepted.
   */
  function procedureChunks(source: string): { name: string; body: string }[] {
    const chunks: { name: string; body: string }[] = [];
    const starts = [...source.matchAll(/^ {2}(\w+):\s*(?=\w)/gm)];

    starts.forEach((match, i) => {
      const from = match.index ?? 0;
      const to = i + 1 < starts.length ? starts[i + 1].index ?? source.length : source.length;
      chunks.push({ name: match[1], body: source.slice(from, to) });
    });

    return chunks;
  }

  const offenders: string[] = [];

  for (const file of routerFiles) {
    const source = readFileSync(file, "utf8");
    if (!/\.delete\(|\.deleteMany\(/.test(source)) continue;

    for (const { name, body } of procedureChunks(source)) {
      const deletes = /prisma\.\w+\.(delete|deleteMany)\(/.test(body);
      if (!deletes) continue;

      const audits = /emitAuditEvent\(|createAuditLog\(/.test(body);
      if (!audits) {
        offenders.push(`${rel(file)} → ${name}`);
      }
    }
  }

  it("has no delete mutation lacking an audit write", () => {
    // Listing the offenders rather than asserting a count: when this fails, the
    // message must name the procedure to fix.
    expect(offenders).toEqual([]);
  });

  it("actually found delete mutations to check — the sweep is not vacuous", () => {
    const checked = routerFiles.filter((f) =>
      /prisma\.\w+\.(delete|deleteMany)\(/.test(readFileSync(f, "utf8")),
    );
    // Guards against a refactor that moves every delete out of src/server/routers
    // and leaves this suite passing while checking nothing at all.
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Client: no destructive mutation fires straight from a click
// ---------------------------------------------------------------------------

describe("no destructive action fires directly from an onClick handler", () => {
  const uiFiles = [
    ...walk(join(ROOT, "src", "app")),
    ...walk(join(ROOT, "src", "components")),
  ];

  /**
   * The shape this forbids:
   *
   *   onClick={() => deleteThing.mutate({ id })}
   *
   * A click on a trash icon must open a confirmation; the mutation fires from
   * the dialog's onConfirm. `onConfirm=` is therefore excluded — that IS the
   * confirmed path.
   */
  const DIRECT_DESTRUCTIVE_CLICK =
    /onClick=\{[^}]*\b(delete|remove|revoke|destroy)\w*\.(mutate|mutateAsync)\(/i;

  const offenders: string[] = [];

  for (const file of uiFiles) {
    const source = readFileSync(file, "utf8");
    // Scan per-line so `onConfirm` on a neighbouring line cannot mask a bad
    // `onClick`, and vice versa.
    source.split("\n").forEach((line, i) => {
      if (DIRECT_DESTRUCTIVE_CLICK.test(line)) {
        offenders.push(`${rel(file)}:${i + 1}`);
      }
    });
  }

  it("has no unconfirmed destructive click handler", () => {
    expect(offenders).toEqual([]);
  });

  it("the confirmation component is genuinely in use across the app", () => {
    // Paired with the check above so 'zero offenders' cannot be achieved by
    // deleting every destructive action rather than confirming it.
    const users = uiFiles.filter((f) =>
      /ConfirmDialog|window\.confirm/.test(readFileSync(f, "utf8")),
    );
    expect(users.length).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// The confirmation copy itself
// ---------------------------------------------------------------------------

describe("confirmation dialogs name the record rather than asking 'are you sure?'", () => {
  const uiFiles = [
    ...walk(join(ROOT, "src", "app")),
    ...walk(join(ROOT, "src", "components")),
  ];

  it("no dialog ships a bare 'Are you sure?' as its description", () => {
    // The issue is explicit that generic copy is the defect, not just the
    // missing dialog: a confirmation that does not say WHICH record is being
    // destroyed does not actually prevent the misclick it exists for.
    const offenders = uiFiles.filter((f) =>
      /description=\{?["'`]\s*Are you sure\??\s*["'`]/i.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
