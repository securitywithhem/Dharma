---
title: Design System
folder: 04_TECHNICAL
tags: [dharma, technical, design, ui, accessibility]
source_docs: [UI:UX.md, 4_UI_UX_DESIGN.md, 2_TRD.md, packages/db/schema.prisma, src/styles/globals.css, tailwind.config.ts]
last_updated: 2026-07-27
status: reviewed
---

# Design System

The visual and interaction language every phase inherits. Companion to
[[Security_Architecture]] (white-label CSS is an untrusted-input surface) and
[[System_Architecture]].

## Provenance — read this before "correcting" the palette

Two planning doc sets describe Dharma's UI, and they disagree:

| Source | Says | Status |
|---|---|---|
| `4_UI_UX_DESIGN.md` (MVP) | Saffron/amber `#D97706` primary on stone greys, light + dark | Superseded |
| `UI:UX.md` (Future Scope), "Design System Extension" | "Keep existing Dharma base (**assume** dark theme, green/blue accents)" | Superseded — and note it says *assume*: it is a placeholder, never a specification |

Both were retired with `obsidian-vaults/Dharma-Project/` in commit `9d28729`
(recoverable via git history). **The implemented system below supersedes both.**
A 2026-07-27 design brief proposed a third direction (dark-first jade `#2F9E6E` +
brass `#C9A227`); it was assessed and declined — its stated basis was that
`UI:UX.md` "already specifies dark theme, green/blue accents," which that line
does not do. What survives from that brief is adopted here: the severity scale,
`StatusBadge`, `DharmaRing`, and `resetTheme`.

> [!important] SUPERSEDED for colour, type, and motion — 2026-07-29
> "Warm Paper" was declined (below), then **adopted by explicit owner override**
> the same day. The palette, typography, and motion rules in this file are no
> longer what ships. See **[[0_DESIGN_SYSTEM]]** in the vault root, with
> `src/styles/tokens.css` and `tailwind.config.dharma.js`.
>
> This file remains authoritative for **component contracts** and for the
> history below — the objections were overruled, not withdrawn, and two of them
> came true: per-tenant white-label theming is now inert, and the five-step
> severity ramp is gone. Both are logged in
> [[0_DESIGN_SYSTEM]] § Accepted costs and in
> `../docs/theme-migration-checklist.md` § Migration 2.

A 2026-07-29 brief proposed a fourth direction — "Warm Paper": terracotta
`#B2481D` on `#EFEBE2`, Newsreader + Public Sans, supplied as
`0_DESIGN_SYSTEM.md` + `tokens.css` + `tailwind.config.dharma.js`. It was
**initially declined** — the assessment is kept below because it is what the
override was made against — for the same reason as the third: it cited
`4_UI_UX_DESIGN.md`'s "dark theme, green/blue accents" as the line it was
superseding, which is the `UI:UX.md` placeholder, in a file retired two commits
earlier. Its concrete costs were:

- **White-label would break silently.** Its tokens are hex. `hexToHslChannels()`
  in `src/lib/theme/getTenantTheme.ts` injects `H S% L%` channel triplets to
  override `--primary`/`--ring` per tenant; hex tokens cannot receive them.
- **It has four flat semantic colours** and no severity ramp or chart ramps —
  dropping the CVD-validated five-step scale the Pentest views depend on.
- **Every shadcn primitive reads `hsl(var(--background))`**, so `dharma-*`
  utilities would have meant rewriting `src/components/ui/`, not reskinning it.

What was adopted from it is its one genuinely better idea: the `{role}-bg` +
`{role}-text` pairing rule for tinted badges, which landed here as the
`--*-on-tint` tokens (see *Component contracts*). The migration it triggered
retokened 68 files onto the *existing* palette — see
`../docs/theme-migration-checklist.md`.

What remains binding from the old docs is the *structure*, not the colour:
`UI:UX.md`'s Key Screens & Components (Marketplace, Connectors, Pentest, AI
Chat, Enterprise Settings, MSSP) are re-skinned, not restructured.

## Identity: Indian pigment

Named for the Sanskrit concept of moral/cosmic order — codified order emerging
from operational noise. The palette is drawn from traditional Indian pigment
rather than generic enterprise blue/violet:

- **Indigo dye (nīl)** `--primary` — the workhorse.
- **Haldi (turmeric)** `--accent` — attention, deliberately *not* primary.
- **Vermilion (sindūr)** `--destructive` / `--critical`.
- **Neem green** `--success`.
- Surfaces are **warm chalk paper**, not cold slate; dark mode is **ink** with
  an indigo cast, never pure black.

Light-first with a full `.dark` block. Tokens are HSL channel triplets — see the
load-bearing format warning at the top of `src/styles/globals.css`.

### Signature element: the Dharma Ring

Concentric arcs resolving out of an unresolved track. Rationed to exactly three
places — the readiness gauge, scan/processing progress, and the primary loading
state. Using it as decoration is what would make it stop meaning anything.
Implemented at `src/components/DharmaRing.tsx`.

## Severity scale

One step per member of the Prisma `Severity` enum (`packages/db/schema.prisma`)
— **exact match, no drift**. Distinct from the `--success`/`--warning`/
`--critical` status tokens: *status* is a control's state, *severity* is a
finding's blast radius, and both appear side by side on vulnerability views.

| Level | Light | Dark |
|---|---|---|
| `NONE` | `40 8% 42%` | `40 6% 52%` |
| `LOW` | `145 34% 30%` | `145 48% 60%` |
| `MEDIUM` | `44 88% 27%` | `44 78% 55%` |
| `HIGH` | `20 88% 39%` | `22 84% 62%` |
| `CRITICAL` | `354 68% 38%` | `354 76% 68%` |

Escalation is a hue sweep (neutral → neem → haldi → orange → lac-red), so the
ramp reads as increasing heat. **Hue is constant across light and dark**; only
lightness moves, and only as far as AA requires — an auditor moving between the
console and an exported light-mode report must not have to relearn the ramp.

Severity tokens sit outside the brand tokens so a white-label tenant recolouring
`--primary` cannot invert what "critical" means. Same rule already applied to
`--success`/`--warning`/`--critical` and the chart ramps.

### What this fixed

The old `SeverityBadge` mapped **both HIGH and CRITICAL to the `destructive`
variant** — identical chip bodies, separated only by a hardcoded dot colour
(`bg-red-500` vs `bg-rose-700`). Two of the five levels an auditor triages by
were near-indistinguishable. `VulnerabilityTrendsChart` carried a *third*,
independently drifted set of hex values that could not follow dark mode.

### Known limitation — MEDIUM/HIGH under protanopia

Light mode forces every severity dark enough to clear 4.5:1 on the card surface.
That compresses the available lightness range exactly where MEDIUM (yellow) and
HIGH (orange) already sit at adjacent hues. No 5-step ramp clears both AA
contrast and a 20+ CVD separation here; the shipped values reach 13.2
(protanopia) for that one pair.

Resolved structurally, not chromatically: **`StatusBadge` always renders the
severity label text**, so colour is redundant reinforcement and never the sole
channel (WCAG 1.4.1). If that component is ever made icon-only, this becomes a
real accessibility defect. All other pairs clear 31+ in both CVD models, and all
ten values clear AA contrast.

Validated by `scripts/validate-severity-palette.js` (AA contrast, normal-vision
separation ≥45, CVD separation ≥12). **Re-run it after any edit to the ramp.**

## Component contracts

- **`StatusBadge`** (`src/components/ui/status-badge.tsx`) — the single severity
  chip for the whole app. Props take the Prisma enum's own SCREAMING_CASE so a
  value read off a `Vulnerability` row passes through unmapped; every mapping
  step is a place the ramp can drift. Ad-hoc severity colouring is a correctness
  bug, not a style preference.
- **`DharmaRing`** (`src/components/DharmaRing.tsx`) — `segments`, `size`,
  `animated`, `total`. Sorts segments by severity regardless of input order.
  `total` supplies a fixed denominator for gauge use (a score of 62 must leave
  38% as unresolved track).
- **`Badge`** (`src/components/ui/badge.tsx`) — non-severity states only.

### Two foregrounds, two jobs: `-foreground` vs `-on-tint`

Every semantic role and every severity step carries two text tokens, and using
the wrong one is a contrast bug rather than a taste question:

| Token | Means | Example |
|---|---|---|
| `--{role}-foreground` | Text on a **solid fill** of that role | white-ish label on `bg-critical` |
| `--{role}-on-tint` | Text on a **~12% wash** of that role over the card | `text-warning-on-tint` on `bg-warning/12` |

Haldi is why this exists. `--warning` sits at 46% lightness, so setting a badge
label in `text-warning` on its own 12% wash measured **2.71:1** — the same root
cause already documented for `--warning-foreground` being ink rather than paper.
The `-on-tint` set darkens (light mode) or lightens (dark mode) only the *text*;
dots, bars, and solid fills keep the base token, so nothing else shifts.

Most `-on-tint` values equal their base token. The complete set exists so the
component rule is uniform — *tinted text always uses `-on-tint`* — instead of
requiring a lookup of which roles happen to need the correction.

**Gates.** `scripts/validate-token-contrast.js` checks every pair in both
modes, compositing washes over the card the way they actually paint (measuring
against the pure token reports a contrast the user never sees).
`scripts/audit-theme-drift.py` fails the build if a component reaches past the
tokens for a raw Tailwind palette class, a hex literal, or a `dark:` override on
a legacy value. Both run without a browser or a database, so they cover states
an axe-core pass over a few screens would never reach — use them alongside axe,
not instead of it.

**Exemptions** are narrow and enumerated in the audit script itself: PDF report
documents (`@react-pdf/renderer` has no custom properties — shared values live
in `src/lib/pdf/palette.ts`), the standalone auditor HTML export, transactional
email, and the marketing page's fixed ink palette. Each mirrors the light-mode
token values as hex and must be updated by hand when a token moves.

## Motion

One orchestrated moment: the ring's 600ms settle when a score or scan resolves,
arcs sweeping in sequentially by severity. Everywhere else motion is
utilitarian (~150ms). Dashboard content does **not** animate on entry — an
operations console is opened dozens of times a day, so entrance motion is a
latency tax; it is reserved for the marketing surface.

`prefers-reduced-motion` is honoured in two layers: a global CSS clamp in
`globals.css`, and — for the ring specifically — a `useSyncExternalStore` check
in the component that skips the animation entirely rather than racing a
zero-duration one. Its server snapshot returns `true` (assume reduced motion) so
the static arc is what server-renders and no animation can flash before
hydration.

## White-label

Runtime tenant overrides ride on the same CSS variables — see
[[Database_Design]] for `OrganizationSettings.whiteLabel` and
`src/lib/theme/getTenantTheme.ts` for resolution. Two invariants worth
restating, both already enforced:

- **Only verified custom domains resolve.** An unverified claim must never
  restyle anything.
- **Tenant CSS rejects `<` outright.** The value renders inside a `<style>` tag;
  allowing `<` would permit a `</style><script>` breakout against every member
  of the org.

`whiteLabel.resetTheme` clears logo/colour/CSS but **preserves `customDomain`
and its verification state** — resetting a theme is a styling action, whereas
dropping the domain would take the tenant's URL offline and force a fresh CNAME
round-trip to undo. Audited as `WHITE_LABEL_RESET` on `AuditLog` (this codebase
extended `AuditLog` rather than adding the planned `AuditEvent` model — see
[[Security_Architecture]]).
