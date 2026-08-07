/**
 * WAVE 11 — scoring semantics, code-splitting, and the tRPC contract boundary.
 *
 * 11.1 closes fullstack-audit-2026-08-06 ARCH-4. `Control.status` does not
 * affect the readiness score: readinessScoring.ts computes
 * (evidencedLeaves/totalLeaves)*85 plus a mapping bonus, and never reads
 * `status`. A compliance officer can mark every control COMPLIANT and watch
 * the framework sit at 0%.
 *
 * THE DECISION (mine, recorded because the audit asked for it explicitly):
 * option (b) — keep the score evidence-driven and make the UI say so.
 *
 * Not option (a) — feeding status into the formula — for two reasons. Evidence
 * is an artifact an auditor can inspect; a self-assessed status is not, and a
 * headline number a user can move by ticking boxes is worth less to the
 * auditor the number exists to convince. And (a) would silently restate every
 * existing org's score overnight. The formula was already defensible and
 * readinessScoring.ts's own header documents its rationale honestly — the
 * defect was the UI not saying so while simultaneously asking users to set a
 * status.
 *
 * So this suite pins two things: the scorer still ignores status (i.e. nobody
 * "fixed" it by quietly implementing option (a) without the product decision),
 * and every surface that shows the number says what it measures.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("11.1 — the score is evidence-driven, deliberately (ARCH-4)", () => {
  const scorer = read("src/server/services/readinessScoring.ts");

  it("readinessScoring still does not read Control.status", () => {
    // If someone implements option (a) later that is a legitimate product
    // decision — but it must be a DECISION, not a quiet edit, because it
    // restates every existing customer's score. This failing is the prompt to
    // update the UI copy below in the same change.
    //
    // Precise about WHICH status: the scorer legitimately reads
    // ControlMapping.status (aliased `cm`) and RecommendationStatus. The
    // Control table is aliased `c` in the raw SQL, so `c."status"` is the
    // read that would mean option (a) had been implemented.
    expect(scorer).not.toMatch(/\bc\."status"/);

    // And the Prisma control query must not select it either.
    const controlSelect = scorer.slice(scorer.indexOf("prisma.control.findMany"));
    const selectBlock = controlSelect.slice(0, controlSelect.indexOf("})"));
    expect(selectBlock).not.toMatch(/\bstatus\b/);
  });

  it("keeps the evidence-weighted formula the header documents", () => {
    expect(scorer).toMatch(/evidencedLeaves/);
    expect(scorer).toMatch(/mappingBonus/);
  });
});

describe("11.1 — the UI says what the number measures", () => {
  it("the gauge names it evidence coverage, not bare 'readiness'", () => {
    // Labelled simply "Readiness", it read as a summary of the whole
    // programme — including the control statuses the user had been setting,
    // which it does not include.
    const gauge = read("src/components/readiness/ScoreGauge.tsx");
    expect(gauge).toMatch(/Evidence coverage/);
  });

  it("the readiness page states plainly that status does not move the score", () => {
    const page = read("src/app/dashboard/frameworks/[id]/readiness/page.tsx");
    expect(page).toMatch(/measures evidence, not self-assessment/i);
    expect(page).toMatch(/does not change this number/i);
  });

  it("says it where the status is actually set, not only where the score is shown", () => {
    // The audit's point was that a compliance officer manages toward the score
    // while setting a field that does not feed it. The warning has to reach
    // them at the moment they set it.
    const modal = read("src/app/dashboard/frameworks/[id]/ControlDetailModal.tsx");
    expect(modal).toMatch(/does not move it/i);
  });
});

describe("11.2 — the AI Advisor is code-split (§8 MEDIUM-1)", () => {
  const trigger = read("src/components/ai-advisor/AIAdvisorTrigger.tsx");

  it("loads the panel through next/dynamic", () => {
    // The trigger mounts in the dashboard layout, so a static import pulled
    // the whole Advisor tree into the shared bundle for every route and every
    // user, including those who never open it. `grep -rn "next/dynamic" src`
    // previously returned zero hits app-wide.
    expect(trigger).toMatch(/from "next\/dynamic"/);
    expect(trigger).toMatch(/dynamic\(/);
  });

  it("does not statically import the panel", () => {
    expect(trigger).not.toMatch(/^import \{ AIAdvisorPanel \}/m);
  });

  it("disables SSR, which would put it back in the initial payload", () => {
    expect(trigger).toMatch(/ssr:\s*false/);
  });

  it("does not even request the chunk until the Advisor is first opened", () => {
    expect(trigger).toMatch(/mounted && <AIAdvisorPanel/);
  });
});

describe("11.3 — the tRPC contract is not defeated at the boundary (§8 MEDIUM-2)", () => {
  const webhooks = read("src/app/dashboard/settings/webhooks/page.tsx");

  it("no longer casts events through `any`", () => {
    // The concrete drift the audit named: `events as any` into
    // createMutation.mutateAsync, at exactly the boundary tRPC exists to
    // protect. Adding or removing an ALLOWED_EVENTS entry server-side produced
    // no type error here at all.
    //
    // Comments stripped first — the fix documents what it replaced, and a
    // naive match would flag that explanation as the defect it describes.
    const code = webhooks
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");

    expect(code).not.toMatch(/events as any/);
    expect(code).toMatch(/mutateAsync\(\{ url, events \}\)/);
  });

  it("derives the event type from the router's own input contract", () => {
    expect(webhooks).toMatch(/RouterInputs\[['"]webhook['"]\]/);
  });

  it("pins the picker options to that contract with `satisfies`", () => {
    // So a stale option is a compile error rather than a runtime Zod failure.
    expect(webhooks).toMatch(/satisfies ReadonlyArray<\{ value: WebhookEvent/);
  });

  it("RouterInputs/RouterOutputs are exported for other components to adopt", () => {
    const trpc = read("src/lib/trpc.ts");
    expect(trpc).toMatch(/export type RouterInputs/);
    expect(trpc).toMatch(/export type RouterOutputs/);
  });
});
