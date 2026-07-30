# Theme migration — retokening onto the Indian-pigment design system

**Status:** in progress · **Started:** 2026-07-29
**Scope:** presentation layer only. No tRPC procedures, no Prisma schema, no queue logic.

## What this migration is (and is not)

This is **not** a palette change. The palette shipped in
[`src/styles/globals.css`](../src/styles/globals.css) and
[`tailwind.config.ts`](../tailwind.config.ts) is unchanged and remains canonical —
warm chalk paper, indigo dye (`--primary`), haldi (`--accent`), vermilion
(`--destructive`), plus the machine-validated `--severity-*`, `--chart-*`, and
`--seq-*` ramps. See
[`Dharma-Knowledge-OS/04_TECHNICAL/Design_System.md`](../Dharma-Knowledge-OS/04_TECHNICAL/Design_System.md).

What this migration does is bring **74 component files that bypass those tokens**
back onto them. Those files hardcode raw Tailwind palette values
(`bg-emerald-500`, `text-slate-400`), literal hex, and hand-written `dark:`
overrides — the exact drift the `--severity-*` ramp and `StatusBadge` were
introduced to stop.

### Why it matters beyond tidiness

1. **White-label correctness.** `getTenantTheme.ts` overrides `--primary`/`--ring`
   at runtime per tenant. A `bg-indigo-600` hardcode ignores the override, so a
   tenant-branded page renders half-branded.
2. **Severity integrity.** Ad-hoc `red-500`/`orange-500` severity colouring is a
   correctness bug — an auditor who learns the ramp on one screen must read it
   identically on the next.
3. **Dark mode.** 143 hand-written `dark:` overrides exist only because the base
   class wasn't a token. Tokens already carry their own `.dark` values, so
   retokening *deletes* these rather than porting them.

### Decisions taken

- **Dark mode is retained** (confirmed 2026-07-29). `next-themes`, `ThemeToggle`,
  and the `.dark` token block stay. Retokening improves it by removing the
  hand-written overrides.
- The "Warm Paper / terracotta" proposal (`0_DESIGN_SYSTEM.md`, `tokens.css`,
  `tailwind.config.dharma.js`) was **not adopted**. It specifies tokens as hex,
  which silently breaks `hexToHslChannels()` white-label injection; it has no
  5-step severity ramp or chart ramps; and it would require rewriting every
  shadcn primitive in `src/components/ui/`. This is the fourth competing
  direction proposed — see the "Provenance" section of the vault
  `Design_System.md` for the prior three.

## Baseline (measured 2026-07-29, pre-migration)

| Metric | Count |
|---|---|
| Files with violations | 74 |
| Raw Tailwind palette classes | 534 |
| Hex literals | 130 |
| `dark:` overrides | 143 |
| Total `.tsx` in `src` | 151 |

Reproduce with `python3 scripts/audit-theme-drift.py`.

## Target mapping

| Legacy pattern | Replacement |
|---|---|
| `bg-white`, `bg-slate-50` | `bg-card` / `bg-background` |
| `bg-slate-100`, `bg-gray-100` | `bg-muted` / `bg-secondary` |
| `text-slate-900`, `text-gray-900` | `text-foreground` |
| `text-slate-500/600`, `text-gray-500` | `text-muted-foreground` |
| `border-slate-200`, `border-gray-200` | `border-border` |
| `bg-indigo-600`, `bg-blue-600` (brand/CTA) | `bg-primary` |
| `bg-emerald-*`, `text-green-*` (pass state) | `bg-success/12 text-success` or `<Badge variant="success">` |
| `bg-amber-*`, `text-yellow-*` (attention) | `bg-warning/12 text-warning` or `<Badge variant="warning">` |
| `bg-red-*`, `text-rose-*` (finding) | `bg-critical/12 text-critical` or `<Badge variant="critical">` |
| per-page severity colouring | `<StatusBadge severity={...} />` — never re-derive |
| ordinal heat scales | `bg-seq-1` … `bg-seq-5` |
| categorical series colours | `chart-1` … `chart-5`, fixed order, never cycled |
| `dark:` companion to any of the above | **delete** — the token carries its own dark value |

## Legitimate exemptions

These keep literal colour and must NOT be "fixed" by the grep gate. Each renders
outside the app's CSS-variable scope.

| File(s) | Why exempt | Action |
|---|---|---|
| `src/lib/pdf/*.tsx` (4 files, 76 hex) | `@react-pdf/renderer` uses `StyleSheet.create` with literal colours. It has no CSS custom properties and no Tailwind. | Exempt, but centralise into one shared palette constant so PDFs track the token values instead of drifting independently. |
| `src/workers/auditorPackage.ts` (18 hex) | Emits a self-contained HTML evidence package opened outside the app. | Exempt from tokens — **but currently uses the generic slate/indigo palette (`#f8fafc`, `#6366f1`), not Dharma's.** Update literals to the pigment values. |
| `src/server/auth.ts` (3 hex) | Transactional email; mail clients strip CSS variables and most `<style>`. | Exempt from tokens — **but `#d97706` is the retired saffron primary from the superseded `4_UI_UX_DESIGN.md`.** Update to indigo. |

## Work breakdown

Ordered lowest-risk first. Shared primitives lead because every screen inherits them.

### (a) Shared primitives — `src/components/ui/`
`badge` · `button` · `card` · `checkbox` · `dialog` · `form` · `input` · `label` ·
`progress` · `select` · `separator` · `skeleton` · `status-badge` · `table` · `textarea`

**Status: already clean.** Zero violations — these were retokened in
`a7bec26` / `63bbd84`. No work required; they define the target idiom.

### (b) Layout shell
- [ ] `src/components/Sidebar.tsx` · `TopNav.tsx` · `ThemeToggle.tsx` · `layouts/DashboardLayout.tsx` — verify clean
- [ ] `src/app/onboarding/layout.tsx` (22)
- [ ] `src/app/audit/portal/layout.tsx` (9)
- [ ] `src/app/page.tsx` (8, marketing surface)

### (c) Per-screen

**Onboarding**
- [ ] `src/app/onboarding/page.tsx` (10)
- [ ] `src/components/onboarding/QuickStartStep.tsx` (9)
- [ ] `src/components/onboarding/FrameworkSelectionStep.tsx` (9)
- [ ] `src/components/onboarding/TeamSetupStep.tsx` (8)
- [ ] `src/components/onboarding/CompletionStep.tsx` (7)

**Evidence**
- [ ] `src/app/dashboard/evidence/[id]/AISuggestionsPanel.tsx` (48)
- [ ] `src/components/evidence/UploadDropzone.tsx` (32)
- [ ] `src/components/evidence/EvidenceList.tsx` (32)
- [ ] `src/app/dashboard/evidence/page.tsx` (15)
- [ ] `src/components/evidence/EvidenceUploadModal.tsx` (12)
- [ ] `src/app/dashboard/evidence/EvidenceUploadForm.tsx` (12)
- [ ] `src/app/dashboard/evidence/[id]/page.tsx` (1)

**Cloud Connectors**
- [ ] `src/components/connectors/ConnectorsList.tsx` (16)
- [ ] `src/components/connectors/ConnectorConfigWizard.tsx` (11)
- [ ] `src/components/connectors/EvidenceMappingBoard.tsx` (10)
- [ ] `src/components/connectors/AutoCollectedBadge.tsx` (4)
- [ ] `src/components/connectors/WebhookDeliveryLog.tsx` (2)
- [ ] `src/components/connectors/CollectNowButton.tsx` (2)

**Frameworks / Controls / Readiness**
- [ ] `src/app/dashboard/frameworks/[id]/page.tsx` (20)
- [ ] `src/app/dashboard/controls/[id]/page.tsx` (16)
- [ ] `src/components/readiness/RecommendationsList.tsx` (16)
- [ ] `src/app/dashboard/frameworks/[id]/DomainBreakdown.tsx` (12)
- [ ] `src/app/dashboard/frameworks/FrameworkCard.tsx` (9)
- [ ] `src/app/dashboard/frameworks/page.tsx` (6)
- [ ] `src/components/controls/treeUtils.ts` (10)
- [ ] `src/components/controls/ControlTreeNode.tsx` (4)
- [ ] `src/components/controls/ControlTree.tsx` (2)
- [ ] `src/components/readiness/FamilyBreakdownTable.tsx` (3)
- [ ] `src/app/dashboard/frameworks/[id]/ControlDetailModal.tsx` (3)
- [ ] `src/app/dashboard/frameworks/[id]/ControlTable.tsx` (1)
- [ ] `src/components/crosswalk/MappableControlTree.tsx` (1)

**Pentest**
- [ ] `src/app/dashboard/pentests/[id]/page.tsx` (6) — severity must route through `StatusBadge`
- [ ] `src/app/dashboard/pentests/PenTestCard.tsx` (5)

**Marketplace**
- [ ] `src/components/marketplace/ReviewSection.tsx` (4)
- [ ] `src/components/marketplace/MarketplaceSidebar.tsx` (2)
- [ ] `src/components/marketplace/MarketplaceGrid.tsx` (2)
- [ ] `src/components/marketplace/ImportModal.tsx` (1)
- [ ] `src/app/dashboard/marketplace/[id]/page.tsx` (2)
- [ ] `src/app/dashboard/publisher/items/page.tsx` (1)

**Enterprise Settings**
- [ ] `src/app/dashboard/AuditLogViewer.tsx` (27)
- [ ] `src/app/dashboard/settings/general/page.tsx` (19)
- [ ] `src/app/dashboard/settings/webhooks/page.tsx` (8)
- [ ] `src/app/dashboard/settings/enterprise/sso/page.tsx` (2)
- [ ] `src/app/dashboard/settings/api-keys/page.tsx` (2)
- [ ] `src/components/enterprise/SsoStatusBadge.tsx` (3)
- [ ] `src/app/dashboard/settings/enterprise/white-label/page.tsx` (1)

**MSSP**
- [ ] `src/app/dashboard/mssp/[orgId]/page.tsx` (4)
- [ ] `src/app/dashboard/mssp/page.tsx` (3)

**Billing**
- [ ] `src/components/billing/UpgradeBannerHeader.tsx` (25)
- [ ] `src/components/billing/BillingOverview.tsx` (6)
- [ ] `src/components/billing/UpgradeBanner.tsx` (5)
- [ ] `src/components/billing/UsageBar.tsx` (2)
- [ ] `src/components/billing/BillingUsage.tsx` (2)
- [ ] `src/components/billing/PlansComparison.tsx` (1)

**Endpoints / Alerts / Reports / AI**
- [ ] `src/app/dashboard/endpoints/page.tsx` (2)
- [ ] `src/app/dashboard/endpoints/[id]/page.tsx` (2)
- [ ] `src/components/endpoints/EndpointStatusDot.tsx` (4)
- [ ] `src/app/dashboard/regulatory-alerts/page.tsx` (3)
- [ ] `src/components/report/ExportReportCard.tsx` (10)
- [ ] `src/components/ai-advisor/MessageInput.tsx` (4)

**Largest single offenders**
- [ ] `src/app/docs/page.tsx` (63)
- [ ] `src/app/dashboard/policies/new/page.tsx` (57)

### (d) Data-visualisation consolidation
- [ ] `src/components/crosswalk/OverlapHeatmap.tsx` (29) — has its own separately
      validated 5-step blue ordinal ramp in hex + `dark:` pairs. This duplicates
      `--seq-1..5`, which is already a validated single-hue sequential ramp with
      its own dark steps. Consolidate onto `bg-seq-*`.
- [ ] `src/components/dashboard/DomainGapHeatmap.tsx` (2)

### (e) Micro-interactions
- [ ] Connector status dot — pulse via opacity, not `box-shadow` glow
- [ ] `EndpointStatusDot` — semantic tokens
- [ ] Evidence auto-collection toast — `success`/`info` tokens
- [ ] Scan/upload progress — `bg-primary` on `bg-muted` track

## Test gates

1. Drift audit returns only documented exemptions — `python3 scripts/audit-theme-drift.py`
2. `npm test` — zero new failures vs. the pre-existing baseline
3. `node scripts/validate-severity-palette.js` — severity ramp still passes AA + CVD
4. Playwright e2e — class-name locator assertions still resolve
5. Contrast pass on Dashboard, Marketplace browse, Pentest detail, AI Chat — WCAG AA
6. Both light and dark verified per screen

## Result

| Metric | Before | After |
|---|---|---|
| Files with violations | 74 | 0 (7 documented exemptions) |
| Raw Tailwind palette classes | 534 | 0 |
| Hex literals outside tokens | 130 | 0 outside exemptions |
| `dark:` overrides | 143 | 1 (`OverlapHeatmap`, justified in-file) |
| Contrast pairs failing AA | 7 | 0 |

Gates: `python3 scripts/audit-theme-drift.py` · `node scripts/validate-token-contrast.js` ·
`node scripts/validate-severity-palette.js` — all exit 0. `tsc --noEmit` clean.
`npx jest` identical to the pre-migration baseline (44 passed / 29 failed suites;
the failures are DB-dependent suites with no Postgres running, and are the same
before and after). ESLint on changed files: 0 errors, 6 pre-existing warnings,
none colour-related.

## Change log

**Steps 1–2 — audit and token layer.** No token-layer work was needed:
`globals.css` is already imported once in the root layout, all three fonts load
via `next/font/google` with `display: "swap"`, and the tenant theme `<style>`
injection is in place. Wrote `scripts/audit-theme-drift.py` as the repeatable gate.

**Step 3 — shared primitives.** All 15 files in `src/components/ui/` were
already clean (retokened in `a7bec26`/`63bbd84`). They defined the target idiom
rather than needing work: token name + `/opacity` wash, `cva` variants, and a
comment for any non-obvious choice.

**Step 4 — screens.** Two codemod passes plus hand edits.

- *Pass 1* (50 files) — unambiguous mappings: neutrals → `foreground`/
  `muted-foreground`/`border`/`muted`, emerald/green → `success`, red/rose →
  `critical`, indigo/blue → `primary`. Each mapping also **deleted** the paired
  `dark:` override rather than porting it.
- *Pass 2* (34 files) — the cases needing classification first, chiefly amber,
  which was doing double duty as both genuine "in progress / attention"
  (→ `warning`) and as the retired saffron brand (→ `primary`). Also: gold
  rating stars → `warning` (haldi is the right family), `stone-400` inactive
  status dots → `muted-foreground`, terminal/code blocks → an inverted
  `bg-foreground`/`text-background` surface, and `text-white` on a semantic fill
  → that fill's `-foreground` token.
- *Hand edits* — progress-bar fills (`[&>div]:bg-*`), the audit portal header,
  `docs/page.tsx` (saffron used as brand throughout: wordmark chip, active nav,
  step badges, code samples; "System Online" became a real `<Badge
  variant="success">`), and `AISuggestionsPanel`.

**Step 4d — heatmaps.** `OverlapHeatmap` carried its own 5-step blue ordinal
ramp as 22 hex literals + `dark:` pairs, duplicating `--seq-*`. Consolidated;
the token ramp also measures better (old step 3 was 4.18:1 against ink, `--seq-3`
is 5.20:1). Dark `--seq-4` was nudged 56% → 54% so the cell label clears AA
(4.38 → 4.78:1); the ramp stays monotonic.

**Step 5 — micro-interactions.** The connector status dot moved from
`animate-ping` to the house opacity pulse — ping expands a second ring to 2×
scale on every row of a list that can hold a dozen connectors. Hover/press
feedback aligned to 150ms `ease-out`; the AI confidence bar moved from 700ms to
the shared `Progress` primitive's 500ms.

### Defects found and fixed along the way

These were not styling issues; the audit surfaced them.

1. **White-label colour picker seeded `#d97706`** — the retired saffron. A
   tenant who had never set a brand colour was shown a swatch matching nothing
   in the product. Now seeds the real `--primary` (`#2D3A80`).
2. **Magic-link sign-in email** used the same retired saffron for its CTA — the
   first thing a new user ever sees.
3. **Auditor HTML evidence package** rendered in the generic slate/indigo
   starter palette (`#f8fafc`, `#6366f1`). This is the first artefact an
   external auditor opens.
4. **All four PDF report documents** carried hand-copied duplicates of the same
   literals, all four drifted to saffron. Centralised in `src/lib/pdf/palette.ts`;
   severity chips now resolve from a shared `pdfSeverity` map so a finding reads
   the same hue on paper as on screen.
5. **Six tinted-badge pairs failed WCAG AA**, worst at 2.71:1 (`text-warning` on
   `bg-warning/12`). All six pre-dated this migration — verified by re-running
   the validator against `HEAD` — but retokening routed far more UI through
   them. Fixed by adding `--*-on-tint` tokens; see the vault `Design_System.md`.

### Deliberate non-changes

- **`src/app/page.tsx`** (marketing) keeps its fixed ink palette, declared as
  named constants. It is an intentionally inverted editorial surface that stays
  dark in both modes, so the light/dark tokens do not apply. Converting it would
  change the design, not the plumbing — out of scope for a styling migration.
- **`bg-black/30` and `bg-black/50` modal scrims** are conventional and correct.
- **The shadow scale** (`xs`–`lg`, indigo-tinted) is a deliberate, documented
  part of `tailwind.config.ts` and was left alone.
- **One `dark:` override survives**, in `OverlapHeatmap`. It is not a colour
  override but a *threshold* override: the sequential ramp runs light→dark in
  one mode and dark→light in the other, so the step at which the label flips is
  genuinely not the same. Explained in-file.

---

# Migration 2 — Warm Paper (terracotta on paper)

**Status:** code complete, verification in progress · **Started:** 2026-07-29
**Scope:** presentation layer only, with one known behavioural regression
(white-label, below). No tRPC procedures, no Prisma schema, no queue logic.

## What changed relative to Migration 1

Migration 1 (above) retokened 68 files *onto* the Indian-pigment palette. The
"Warm Paper" proposal it had declined was subsequently **adopted by owner
override** on 2026-07-29, with its costs stated and accepted. This migration
therefore re-themes the same surfaces a second time, onto hex `--dharma-*`
tokens.

Canonical spec: [`Dharma-Knowledge-OS/0_DESIGN_SYSTEM.md`](../Dharma-Knowledge-OS/0_DESIGN_SYSTEM.md)
Tokens: [`src/styles/tokens.css`](../src/styles/tokens.css)
Tailwind fragment: [`tailwind.config.dharma.js`](../tailwind.config.dharma.js)

## Blast radius

138 files referenced a themeable class. Grouped as migrated:

- **Shared primitives** (14) — `src/components/ui/`: button, badge,
  status-badge, card, input, dialog, select, table, progress, checkbox, label,
  form, separator, skeleton.
- **Layout shell** — root layout, `TopNav`, `Sidebar`, onboarding layout,
  audit-portal layout.
- **Per-screen** — Marketplace, Connectors, Pentest, AI Chat, Enterprise
  Settings, MSSP, Frameworks/Controls, Evidence, Audit portal.

## How it was applied

1. **Token layer.** `tokens.css` imported in the root layout *before*
   `globals.css`. Tailwind `extend` block merged into the real
   `tailwind.config.ts` (merged, not replaced — the existing `fontSize`,
   `boxShadow`, `keyframes`, and chart/severity colour scales are untouched).
2. **Fonts.** Inter Tight → Public Sans, JetBrains Mono → IBM Plex Mono.
   Fraunces retained as the voice serif (the spec names "Newsreader or
   Fraunces", and Fraunces was already loaded — no font added).
3. **Pass 1** (133 files, 1123 lines) — deterministic class renames.
4. **Pass 2** (22 files) — residuals and artefacts of pass-1 ordering.
5. **Flatten pass** (31 files) — restraint rule 1: every `shadow-*` became a
   hairline `border border-dharma-border`; `backdrop-blur-*`, `bg-gradient-to-*`
   and `bg-dharma-radial` removed.
6. **Hover-inversion fix** (13 files) — see defects below.
7. **Motion** — all four over-cap durations (`duration-200`/`500`) moved to
   `duration-dharma-base` (150ms). `animate-bounce` on the AI typing dots
   became the house `animate-pulse-subtle`.

## Defects found and fixed during this migration

1. **Inverted hover on every accent-filled control.** The old palette expressed
   a hover as `bg-primary/90` — the same hue at 90% alpha, i.e. *darker*. Hex
   tokens take no alpha, so the mechanical mapping sent those to
   `bg-dharma-accent-tint`, a pale wash: every primary button would have
   **lightened** on hover instead of darkening. Repointed to
   `--dharma-accent-hover` across 13 files. The same dead-hover shape on the
   four semantic roles was repointed to the hover surface.
2. **Comment corruption.** The rename passes rewrote token names inside prose
   comments in `button.tsx` and `badge.tsx`. Repaired by hand; a repo-wide
   scan for the same shape came back clean.

## Deliberate deviations from the spec

Recorded so they are not "corrected" back. Full reasoning in
`0_DESIGN_SYSTEM.md` § Accessibility reconciliations.

- **Warning chips use ink, not `--dharma-warning-text`.** The specified pair is
  4.48:1 — 0.02 under the AA floor, conforming only as large text. A chip is
  11px. No spec hex was altered; an existing token was substituted for a size
  class the specified pair cannot serve.
- **`--dharma-text-muted` is not used for any readable string.** It fails AA at
  every size (2.85:1). `text-muted-foreground` mapped to
  `--dharma-text-secondary` (5.54:1), not to the muted token.
- **Focus rings use the accent, not a border token.** Neither border token
  clears the 3:1 WCAG 1.4.11 floor.
- **`--chart-*` / `--seq-*` retained** as HSL tokens — Warm Paper supplies no
  replacement, and dropping them would break the heatmap and charts.

## Deliberate non-changes (carried over from Migration 1)

- `src/app/page.tsx` (marketing) keeps its fixed ink palette.
- `bg-black/30` and `bg-black/50` modal scrims are conventional and correct.
- The `OverlapHeatmap` `dark:` threshold override — a threshold, not a colour.
- `src/lib/pdf/palette.ts`, `src/workers/auditorPackage.ts`, and the
  white-label colour picker still carry hex literals **and have NOT been
  repointed at Warm Paper**. See outstanding work.

## Outstanding

- [ ] **PDF/report and auditor-package palettes** still render the Indian-pigment
      colours. On-screen and on-paper artefacts now disagree.
- [ ] **White-label colour picker** seeds `--primary` (`#2D3A80`), which is no
      longer the brand colour.
- [ ] **Per-tenant theming is inert** — `hexToHslChannels()` cannot drive hex
      tokens. Accepted cost (1); needs a re-implementation.
- [ ] axe-core pass on Dashboard, Marketplace, Pentest detail, AI Chat.
- [ ] Visual regression baselines — update only after manual confirmation.
- [ ] One-accent-per-screen: 19 files hold more than one `bg-dharma-accent`.
      Most are cva variants or mutually-exclusive branches; needs a rendered
      check, not a static count.
