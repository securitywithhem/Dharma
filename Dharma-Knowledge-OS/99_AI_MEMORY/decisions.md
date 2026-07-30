---
title: Decisions
folder: 99_AI_MEMORY
tags: [dharma, ai-memory, decisions]
source_docs: []
last_updated: 2026-07-29
status: stable
---

# Decisions

| Date | Decision |
|---|---|
| 2026-07-23 | Vault content mapped to the docs that actually exist in this repo, not invented to fit the original bootstrap template's assumed `1_PRD.md` root-level layout and Phase-0-starting-point — see [[Dharma_Master_Context]] for the full doc-vs-code gap analysis. |
| 2026-07-23 | New vault created at `Dharma-Knowledge-OS/` rather than merged into the existing `obsidian-vaults/Dharma-Project/`, to keep raw source docs separate from synthesized/cross-linked notes. |
| 2026-07-27 | Kept the implemented indigo/haldi "Indian pigment" palette; declined a proposed dark-first jade/brass rework. The proposal's stated basis was that `UI:UX.md` "already specifies dark theme, green/blue accents" — that line actually reads "**assume** dark theme", a placeholder, not a specification. Adopted the proposal's genuinely missing parts instead (severity scale, `StatusBadge`, `DharmaRing`, `resetTheme`). See [[Design_System]]. |
| 2026-07-27 | Severity gets its own 5-step token ramp keyed to the Prisma `Severity` enum, separate from the `--success`/`--warning`/`--critical` status tokens: status is a control's state, severity is a finding's blast radius, and both render side by side. Hue held constant across light/dark so auditors don't relearn the ramp in exported reports. |
| 2026-07-27 | `whiteLabel.resetTheme` preserves `customDomain` and its verification. Resetting a theme is a styling action; clearing the domain would take the tenant's URL offline and need a fresh CNAME round-trip to undo. |
| 2026-07-29 | Declined a fourth proposed palette ("Warm Paper", terracotta `#B2481D` + Newsreader/Public Sans, supplied as `0_DESIGN_SYSTEM.md`/`tokens.css`/`tailwind.config.dharma.js`). It repeated the 2026-07-27 error: it cited `4_UI_UX_DESIGN.md`'s "dark theme, green/blue accents" as the thing being superseded, but that line is the `UI:UX.md` placeholder ("**assume** dark theme") and both docs were retired in `9d28729`. Concretely it would have (a) broken white-label — its tokens are hex, and `hexToHslChannels()` injects `H S% L%` channel triplets, (b) dropped the 5-step severity ramp and both chart ramps for four flat semantic colours, (c) required rewriting every shadcn primitive, which reads `hsl(var(--background))`. See [[Design_System]]. |
| 2026-07-29 | Kept dark mode. It is shipped (`next-themes`, `ThemeToggle`, a full `.dark` token block with separately validated ramps), and retokening *removed* 143 hand-written `dark:` overrides rather than porting them — the tokens already carry their own dark values. |
| 2026-07-29 | Added `--*-on-tint` tokens, one per semantic role and severity step. `-foreground` means "text on a solid fill"; `-on-tint` means "text on a ~12% wash of the same role over the card". They are different jobs and haldi proved it: `text-warning` on `bg-warning/12` measured 2.71:1. Same root cause the file already documented for `--warning-foreground` being ink rather than paper. Gated by `scripts/validate-token-contrast.js`. |
| 2026-07-29 | AI-assisted surfaces are marked with haldi (`--accent`) as a standing convention. `AISuggestionsPanel` was already approximating this with `amber-500` by eye; the policy-builder "AI Audit" action was on `purple-100`. One token, one meaning. |

See [[Decisions]] in `05_DEVELOPMENT` for the code-facing mirror of this log.

## 2026-07-29 — "Warm Paper" adopted by owner override

The terracotta-on-paper direction (`#B2481D` on `#EFEBE2`, Fraunces + Public
Sans + IBM Plex Mono) was assessed, declined, and then **adopted by explicit
owner override** after the decline and its costs were presented. Canonical spec
is now `0_DESIGN_SYSTEM.md` in the vault root; `04_TECHNICAL/Design_System.md`
is superseded for colour/type/motion and retained for component contracts.

Three costs were stated before adoption and accepted:

1. Tokens are hex, so `hexToHslChannels()` cannot drive them — **per-tenant
   white-label colour override is inert**. This is a behavioural regression in
   a shipped Phase 8 feature, not a styling one.
2. The five-step CVD-validated `--severity-*` ramp is gone; five severities map
   onto four semantic roles, so HIGH and CRITICAL share a hue and are separated
   by weight plus the always-rendered text label.
3. `src/components/ui/` was rewritten rather than reskinned.

`--chart-*` and `--seq-*` were **kept** — Warm Paper supplies no replacement,
and dropping them would have broken the crosswalk heatmap and the charts.

Three spec pairs failed WCAG AA as written. Hex was fixed by instruction, so
each was resolved as a usage constraint, not a colour edit: `text-muted` is
barred from readable text (2.85:1); warning chips use ink rather than the
4.48:1 warning text; focus rings use the accent because neither border token
clears 3:1. Machine-checked by `scripts/validate-dharma-contrast.js` — 44 pairs,
light and dark, all pass.

Dark mode was **retained**; a dark Warm Paper variant was authored (it is not
part of the approved spec, and is the one part open to taste).

---

## 2026-07-30 — Compliance Status dashboard: structural redesign, palette untouched

A second design brief arrived asking for a cool slate/graphite token rebuild and
naming cream+terracotta as a generic-AI tell to avoid. That is the palette
adopted by owner override the previous day (`634c9ec`). **The owner chose to
keep Warm Paper** and scope this pass to structure only. No colour token in
`src/styles/tokens.css` was changed. Do not re-open this.

The brief also restated premises that were already stale: it asked for a
`Skeleton` primitive, loading states, and sidebar hover/focus states that all
already existed, and it cited the retired `1_PRD.md .. 6_IMPLEMENTATION_PLAN.md`
doc set (removed in `9d28729`). Live spec is `0_DESIGN_SYSTEM.md`.

**Severity is now one module, not two.** `src/lib/compliance/severity.ts` is
imported by `dashboardRouter.getStats` *and* the client. The brief proposed a
server copy plus a client copy kept in agreement by test; two implementations
that must be kept in sync is the defect, not the safeguard. This fixed a live
bug — `page.tsx` banded at 50/80 while `FrameworkProgressCards.tsx` banded at
60/80, so one framework could read "At risk" in one place and "Needs work" in
another. `FrameworkProgressCards.tsx` was deleted (imported but never rendered);
`FrameworkStatusCard.tsx` replaces both.

`getStats.frameworks[].severity` is a new **additive** field. No Prisma change.

**Trend/sparkline was deliberately NOT built.** There is no time-series source
in the schema; the only history is `AuditLog`, and deriving per-framework
readiness over time from it is a feature, not a re-skin. Adding the brief's
`previousStatusPercent` column would have shipped a permanently-null field and a
component that never renders. Needs a `FrameworkReadinessSnapshot` model plus a
scheduled job — separate work.

Other corrections made: every framework card printed the same **organisation-wide**
critical-gap count as if it were that framework's; a framework with 0 controls
banded as complete (now `critical`); `v{version}` rendered SOC 2's "Type II" as
"vType II".

Rationale in `docs/design/dashboard-redesign-tokens.md`.
