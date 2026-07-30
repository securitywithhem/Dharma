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

Rationale in `../docs/design/dashboard-redesign-tokens.md`.

---

## 2026-07-30 — Dashboard layout contract: track occupancy, not container width

The dashboard had three sections that "did not use the full screen". The
diagnosis that matters, because it was wrong in the brief and would have been
wrong by eye: **container width was never the problem.** Every row already
inherited `max-w-[88rem]` from the single page container and always had.

The bug was **empty grid tracks**. `lg:grid-cols-3` reserves three columns
whether or not three children render:

- Row 3 held one `lg:col-span-2` child, so a third of the row was empty by
  construction.
- Row 4 held three children, but `ImportedFrameworksCard` returns `null` when
  the org has no imports — two cards, three tracks, dead gutter.

Neither is fixed by `w-full`, and neither would have been prevented by a
`Section` primitive with a `span` prop, which is what the brief proposed.

**Rule now in force** (documented at the top of `src/app/dashboard/page.tsx`):
rows with a fixed child count may use explicit columns; rows whose child count
depends on data MUST use `<CardRow>`, whose `auto-fit` tracks collapse when a
child does not render. Row 2 keeps its deliberate 2/3 + 1/3 split.

`src/components/ui/section.tsx` exists for the repeated `<section
aria-labelledby>` + heading wiring, not for width. `titleHidden` sets
`aria-label` instead of rendering a screen-reader-only `h2`, so a row whose Card
already has a visible title does not announce that title twice.

Domain gap analysis goes two-up from `xl` — at full width a single column
stretched each progress bar into a ~1300px sliver. `COLLAPSED_COUNT` moved 5 → 6
to fill whole rows and is now exported so tests and the button label cannot
drift from it (both had hardcoded "5").

Guard: `tests/e2e/dashboard-layout.spec.ts`. The load-bearing assertion is not
row-width equality (always true) but that each row's *content* reaches its own
right edge. Also asserts equal card heights and even splits in Row 4.

Also fixed: `DashboardSkeleton` still mirrored the pre-redesign layout, so the
page reflowed when data landed — the exact thing that skeleton exists to prevent.

---

## 2026-07-30 — Grids are container-relative, not viewport-relative; sidebar pinned

Reported: horizontal scroll on the dashboard, inconsistent section spacing, and
a sidebar that scrolled away with the page.

**The overflow did not reproduce headless** at any width from 1280–1920, which
is itself the finding. The framework grid chose its column count from a `xl:`
media query — a **window** measurement — while the grid actually lives in
`window − 240px sidebar − 48px page padding`. Just above the 1280px breakpoint
it committed to three columns the available space could not hold. The failure
band is narrow, sits *between* the round numbers anyone would test, and widens
under browser zoom (zoom shrinks the CSS viewport, so the window/container gap
lands differently).

**Rule: any grid inside the content column sizes from its container, not the
viewport.** `repeat(auto-fit, minmax(min(Xrem, 100%), 1fr))` asks the real
container how much room there is. Applied to the framework grid (22rem tracks,
now via `CardRow`) and the domain list (26rem). `min(X, 100%)` matters — a bare
`Xrem` minimum overflows narrow screens by itself. Viewport breakpoints remain
correct only for the page shell, where the window *is* the container.

Consequence: no CSS selector can identify "the last row of a column" once the
count is decided at runtime, so domain rows are uniformly ruled and the expand
toggle dropped its `border-t` to avoid stacking two rules.

Spacing: the framework grid used `gap-3` while every other row used `gap-4`.
Unified to 16px, skeleton included.

Sidebar is `sticky top-0 h-screen` — still in flow, so the main column keeps
reserving its 240px and needs no offset.

Guard extended in `tests/e2e/dashboard-layout.spec.ts`: a 41-step sweep from
320→1920px checking `documentElement`, `body` AND `main` (an inner container can
scroll while the document does not — the gap that let this through), plus an
assertion that the sidebar stays pinned and Settings is reachable after
scrolling to the bottom. Overflow checks now use `expect.poll`; a single sample
taken at `networkidle` under parallel workers reads mid-reflow and flakes.

---

## 2026-07-30 — Dashboard is a fixed-viewport app shell; `main` is the only scroller

Third report of horizontal scroll, still not reproducible headless at any width
320–1920 or on any scrollable box. Stopped chasing the repro and built the
architecture the owner had by then described three times.

`src/components/layouts/DashboardLayout.tsx`:

```
<div class="flex h-dvh overflow-hidden">   <- page never scrolls
  <Sidebar />                              <- constant, no positioning trick
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="shrink-0">chrome</div>
    <main id="dashboard-scroll"
          class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
```

Three details are load-bearing:

- **`min-h-0` on main.** A flex child defaults to `min-height:auto` and refuses
  to shrink below its content, so without it the column grows past the viewport
  and the document scrolls after all — silently undoing the entire arrangement.
- **`overflow-x: hidden` makes sideways scrolling impossible, not merely
  absent.** Be honest about it: it clips rather than fixes. The real fix remains
  the container-relative (`auto-fit`) grids, which leave nothing to clip. This
  is the backstop so a future `w-[1200px]` degrades to a clipped edge instead of
  a page the user drags sideways.
- **`h-dvh`, not `h-screen`,** so collapsing mobile browser chrome does not
  leave the shell taller than the visible area.

The sidebar no longer needs `sticky top-0` and TopNav's `sticky top-0` was dead
(it sits above the scroll container). Both removed — a leftover sticky is a
thing to misread later. `Table`'s sticky header now sticks to `main`, which is
what it always wanted.

**Testing note that matters more than the fix:** the guard previously measured
`document.documentElement`, which in this shell is *always* 0 — the document
cannot scroll. A test asserting on it would pass forever while an inner
container dragged sideways. `measureHorizontalOverflow()` now walks every box
with `overflow-x: auto|scroll` and the test additionally forces
`main.scrollLeft = 9999` and asserts it comes back 0.

Four e2e failures seen during this work (regulatory-alerts ×2, vulnerability,
reports ×1) were **A/B-verified against the pre-change shell and fail
identically** — pre-existing, unrelated. `endpoints` ×2 fail only under parallel
workers and pass serially: shared-DB contention, not layout.

---

## 2026-07-31 — Compact density pass; the reported overflow was a stale bundle

Third report of horizontal scroll. **Measured the live authenticated DOM before
changing anything**: root `flex h-dvh overflow-hidden`, `main#dashboard-scroll`
`overflow-x: hidden`, framework grid `442px 442px` at viewport 1188, `373 373
373` at 1440, horizontal overflow 0 on document, body and main at every width
320–1920. An auto-fit grid cannot render a partially cut-off card. The reported
screenshot showed one, plus a scrolling sidebar the current shell does not have
— **the browser tab was running a pre-restart bundle.** Recorded because the
same report may recur: measure the live DOM first, do not patch from a
screenshot.

The work below is real, found while confirming that, and was approved as a
compact-density pass (spacing only; type sizes and tokens untouched).

Density: page row gap 24→16, section heading margin 12→8, card padding 20→16
(comfortable) and 14→12 (compact), readiness ring 56→44px, framework track floor
22→18rem, domain list 26→22rem, workspace 20→18rem. Result at 1440: page height
1410px against a 778px viewport, and the domain list gains a third column.

**A prediction in the plan was wrong and is corrected here:** it claimed the
framework grid would go 3→4 columns. It does not. The grid's content box is
1152px (main 1200 minus its own 24px padding), so a 4th 18rem track needs
4×288 + 3×16 = 1200 > 1152. It also would not have helped — five cards occupy
two rows at either 3 or 4 columns, so a 4th column saves no height and only
truncates names. The guard asserts ≥3 tracks plus a total-scroll-height ceiling,
which is the measure that actually tracks density.

Defects fixed alongside:
- `UpgradeBannerHeader` used `max-w-7xl` (1280) + `sm:px-6` while the page uses
  `max-w-[88rem]` (1408) + the shell's `sm:px-5 lg:px-6`, so the banner rail
  misaligned with the page heading on any screen >1280px. Now matched exactly.
- Row 2 was the last viewport-breakpoint grid (`lg:grid-cols-3`); `lg:` fires at
  window 1024 where the container is only ~736, squeezing the activity column to
  ~235px. Converted to the same inline auto-fit pattern as `CardRow`
  (`@tailwindcss/container-queries` is not installed and was not worth adding).
- Unbounded user strings given `min-w-0` + `truncate`: `item.itemName`
  (ImportedFrameworksCard) and `report.fileName` (ExportReportCard).
- `DashboardSkeleton` now renders through `CardRow` with the same track floors
  as the real rows, so it cannot drift and cause the reflow it exists to prevent.
- `AIAdvisorPanel` is `position: fixed` and therefore escapes the shell's
  `overflow-x-hidden`; at its 440px default and 360px resize floor it exceeded a
  390px viewport. Capped with `max-w-[100vw]`. Also removed a duplicated
  `border` class that was overriding its `border-l`.
- Sidebar brand header and Settings/Sign out footer are `shrink-0`, so a short
  viewport squeezes the scrollable nav rather than the fixed frame.

---

## 2026-07-31 — Sidebar is toggleable; mobile navigation was unreachable

Owner asked for a click-to-show sidebar. Building it also fixed a genuine
defect, which is the part worth remembering.

**The bug:** `<aside className="hidden md:flex …">` with **no opener anywhere**.
Below 768px the entire navigation was `display: none` — Settings, Sign out and
every section link — with no hamburger, no drawer, no route out of the current
page. Verified across widths: aside display is `flex` at 900+, `none` at 767 and
below. Every prior pass measured overflow and contrast and never asked whether
the nav could actually be opened.

**Now:** one piece of state in `DashboardLayout` (which became a client
component), one toggle button rendered through a new `leading` slot on `TopNav`
so it stays reachable when the sidebar is closed. Two presentations:

- **md and up** — in-flow column. Closing removes it and the content genuinely
  reflows wider: `main` gains ~240px and the framework grid goes 3 → 4 columns,
  because the grids are container-relative rather than breakpoint-driven. That
  property is what makes a collapsible sidebar worth having here.
- **below md** — fixed drawer over a scrim, closed by default. Escape closes it;
  following a nav link closes it (otherwise the drawer hides the destination).

`Sidebar` unmounts when closed rather than hiding, so its links cannot linger in
the accessibility tree. It takes `id` / `open` / `overlay` / `onNavigate`; the
shell owns the state.

Guards in `tests/e2e/dashboard-layout.spec.ts`: mobile drawer opens from the
toggle, Escape closes it, opening it creates no horizontal scroll; desktop
collapse frees ≥200px of content width and restores. Note the nav-link assertion
must be scoped to the aside and use `exact: true` — the page body renders an
"Upload evidence" CTA that a loose "Evidence" match collides with.

**Still unexplained:** the owner's browser renders the dashboard with NO sidebar
at a ~1495px viewport where a fresh session renders it at 240px (their card
geometry puts the container at the 1408px max-width, i.e. no sidebar column).
Fresh Playwright sessions have never reproduced it. Presumed stale dev bundle.
The toggle makes this moot — the sidebar can now always be summoned.
