/**
 * WAVE 9.2 — every list view distinguishes an outage from an empty result.
 *
 * Closes fullstack-audit-2026-08-06 §6 HIGH-1: error handling correlated with
 * which sprint touched a module rather than with importance. Ten modules had no
 * error branch, so a backend outage resolved skeletons into a zero state and
 * the user read "0 frameworks, 0 evidence, 0% ready" as a fact about their
 * compliance posture rather than as a failed request.
 *
 * A static check rather than ten rendering tests, deliberately. The defect is
 * an ABSENCE spread across files, and the failure mode is someone adding an
 * eleventh page without one. Rendering tests would pin the pages that exist
 * today; this pins the rule.
 *
 * CORRECTION TO THE AUDIT recorded here because it changed the work: §6's
 * state-coverage table counted occurrences of `isError` only, and reported
 * `/dashboard` as having "12 loading indicators and zero error branches". That
 * is wrong — dashboard/page.tsx destructures `error` (not `isError`) and has
 * always rendered a distinct <LoadFailure/>. The genuine gap was eight other
 * pages. /dashboard's real shortcoming was the absence of a retry affordance:
 * its copy asked the user to refresh the browser by hand.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");

/**
 * Pages whose primary job is rendering server data. Each must be able to say
 * "this failed" as something other than "there is nothing here".
 */
const DATA_PAGES: Array<[label: string, file: string]> = [
  ["dashboard", "src/app/dashboard/page.tsx"],
  ["cross-walk", "src/app/dashboard/cross-walk/page.tsx"],
  ["marketplace", "src/app/dashboard/marketplace/page.tsx"],
  ["endpoints", "src/app/dashboard/endpoints/page.tsx"],
  ["regulatory-alerts", "src/app/dashboard/regulatory-alerts/page.tsx"],
  ["mssp", "src/app/dashboard/mssp/page.tsx"],
  ["publisher/items", "src/app/dashboard/publisher/items/page.tsx"],
  ["settings/enterprise/roles", "src/app/dashboard/settings/enterprise/roles/page.tsx"],
  ["policies", "src/app/dashboard/policies/page.tsx"],
  ["policies/[id]", "src/app/dashboard/policies/[id]/page.tsx"],
  // The connectors page delegates entirely to this component and has no
  // boundary of its own, so the state handling belongs here.
  ["settings/connectors (ConnectorsList)", "src/components/connectors/ConnectorsList.tsx"],
];

function read(file: string): string {
  const full = path.join(ROOT, file);
  if (!existsSync(full)) throw new Error(`Missing file: ${file}`);
  return readFileSync(full, "utf8");
}

describe("every data page has an error branch (§6 HIGH-1)", () => {
  it.each(DATA_PAGES)("%s renders a distinct error state", (_label, file) => {
    const source = read(file);

    // Either the shared component, or a page-local branch that predates it
    // (dashboard's LoadFailure). What must NOT be true is that the page reads
    // a query and has no way to express failure.
    const branchesOnError =
      source.includes("QueryError") ||
      /isError/.test(source) ||
      /if \(error\)/.test(source);

    expect({ file, branchesOnError }).toEqual({ file, branchesOnError: true });
  });

  it.each(DATA_PAGES)("%s offers a retry", (_label, file) => {
    const source = read(file);
    // QueryError's onRetry, or an explicit refetch wired to a control.
    const hasRetry = /onRetry|refetch\(\)/.test(source);
    expect({ file, hasRetry }).toEqual({ file, hasRetry: true });
  });
});

describe("the shared component is used rather than re-hand-rolled (P1)", () => {
  it("is adopted by most of the swept pages", () => {
    // The audit's pattern P1 is that this repo builds a control once and never
    // generalises it — empty-state.tsx in 4 of ~20 views, confirm-dialog in 3.
    // If a future sweep hand-rolls error cards again, this drops.
    const adopting = DATA_PAGES.filter(([, file]) => read(file).includes("QueryError"));
    expect(adopting.length).toBeGreaterThanOrEqual(8);
  });

  it("QueryError always renders the server's message when there is one", () => {
    const source = read("src/components/ui/query-error.tsx");
    expect(source).toContain("message");
    // A user who cannot tell an outage from a permission problem cannot decide
    // whether to retry or to call someone.
    expect(source).toMatch(/message \?\?/);
  });
});

describe("no window.confirm survives anywhere (§6 MEDIUM-2)", () => {
  it("has zero native confirm call sites", () => {
    // Pinned here rather than in the dialog suite because the finding is about
    // the whole app, not one component: the audit named two sites, and the fix
    // had to verify those were in fact all of them.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execFileSync(
      "bash",
      [
        "-c",
        `grep -rn "window\\.confirm\\|[^.a-zA-Z]confirm(" ${ROOT}/src --include='*.tsx' --include='*.ts' || true`,
      ],
      { encoding: "utf8" },
    );

    const real = out
      .split("\n")
      .filter(Boolean)
      // Exclude our own identifiers and prose mentioning the retired API.
      .filter((line) => !/confirmLabel|ConfirmDialog|onConfirm|confirmDelete|setConfirm|confirmCheckout|ownershipConfirmed|confirmVerification|not window\.confirm/.test(line));

    expect(real).toEqual([]);
  });
});
