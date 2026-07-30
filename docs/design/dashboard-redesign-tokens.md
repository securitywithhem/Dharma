# Compliance Status dashboard — redesign plan

**Date:** 2026-07-30
**Scope:** `/dashboard` (Compliance status) and the primitives it pulls from `src/components/ui/`.
**Palette authority:** [`Dharma-Knowledge-OS/0_DESIGN_SYSTEM.md`](../../Dharma-Knowledge-OS/0_DESIGN_SYSTEM.md) — "Warm Paper", adopted `634c9ec`.

---

## 0. What this pass is, and what it deliberately is not

The brief that triggered this work asked for a **new token system** — a cool
slate/graphite base with a fresh signal ramp — and named cream-plus-terracotta
as a generic-AI-design tell to avoid.

That instruction was **not followed, by owner decision on 2026-07-30.** Warm
Paper (`#EFEBE2` paper, `#B2481D` terracotta) was adopted one commit earlier by
explicit owner override *after* it had been assessed and declined. Re-skinning
it a day later would revert a signed-off decision, not improve it.

So: **no colour token in `src/styles/tokens.css` changes in this pass.** Not one.
The dashboard's problems as photographed — dead whitespace, undifferentiated
repetition, no state design, no priority ordering — are **structural, not
chromatic**, and every one of them is fixable inside the adopted palette. That
is the whole of this document.

The brief's own generic-AI-tell test still gets applied below; it is just applied
to *layout and behaviour* rather than to hex values.

---

## 1. Palette — unchanged, but newly **disciplined**

No new tokens. The existing four semantic roles carry the whole severity system:

| Role | Token pair | Dashboard meaning |
|---|---|---|
| danger | `--dharma-danger-bg` / `-text` | `critical` — under 50% ready |
| warning | `--dharma-warning-bg` / `-text` | `partial` — 50–79% |
| success | `--dharma-success-bg` / `-text` | `healthy` 80–99%, `complete` 100% |
| info | `--dharma-info-bg` / `-text` | non-status metadata only |

Plus the retained `--seq-1 … --seq-5` sequential ramp, already used by the domain
list. It stays: a five-step magnitude scale cannot be encoded by four categorical
roles, which is exactly why `634c9ec` kept it as HSL.

**What actually changes is usage, not value.** Today the dashboard spends colour
on things that are not status:

- The page-inlined framework card paints a 4px left border on *every* card,
  including healthy ones. A green rule on a healthy card is decoration; it burns
  the reader's severity channel on "nothing is wrong here."
  → **Only `critical` and `partial` carry a coloured rule. Healthy and complete
  cards get a plain hairline.** Quiet until something is wrong, per the token
  file's own stated intent.
- `healthy` and `complete` share the success hue and are separated by the always-
  rendered text label ("On track" / "Complete"), never by hue alone. This is the
  same load-bearing-label constraint `634c9ec` accepted for HIGH vs CRITICAL, and
  it is honoured here rather than worked around (WCAG 1.4.1).

### Accessibility constraints inherited, not re-litigated

- `--dharma-text-muted` (2.85:1) is barred from every readable string on this
  page. All meta lines use `--dharma-text-secondary` (5.54:1).
- The warning pair is 4.48:1 and conforms only as large text. Every warning chip
  on this page renders at `text-micro` (11px), so it uses ink (13.34:1) — the
  behaviour the `Badge` primitive already enforces. `SeverityBadge` inherits
  `Badge` rather than restating the pairing, so this cannot drift.
- Neither border token clears 3:1, so no focus ring or interactive boundary uses
  them. Focus is `ring-dharma-accent` throughout (WCAG 1.4.11).

---

## 2. Type — unchanged

`--font-display` (voice) for the h1 and for the hero percentage; `--font-sans`
for all UI; `--font-mono` for identifiers (framework version chips, control IDs).
Already loaded via `next/font`. **No new typeface is imported.**

The one change is *scale discipline*: the framework card's percentage moves from
`text-2xl` to a genuinely display-sized `text-[2rem]` with `tabular-nums` and
`leading-none`, because it is the hero datum of the card and currently competes
with the framework name at nearly the same optical weight.

---

## 3. Layout — killing the dead space

### Before (as photographed)

```
┌────────────────────────────────────┐
│ ISO 27001                     0%   │
│ v2022                      At risk │
│                                    │   ← dead
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  │
│ 0 of 93 controls                   │
│                                    │   ← dead
│ ──────────────────────────────     │
│ Key gaps:                          │
│ 93 controls incomplete             │
│ ⚠ 12 critical gaps                 │   ← org-wide count, not this framework's
└────────────────────────────────────┘
```

### After

```
┌──────────────────────────────────────────────┐
│  ╭───╮   ISO 27001  [v2022]                  │
│  │ 0%│   0 of 93 controls · 93 outstanding   │
│  ╰───╯   [critical] [12 high-gap domains]    │
└──────────────────────────────────────────────┘
```

One horizontal band. The ring, the name, the counts and the severity chips are a
single visual unit with no vertical gap to fall through — the percentage is
*inside* the progress indicator instead of floating diagonally opposite it.
Card height is set by content, not by a fixed grid row.

Key gaps become **inline chips**, not a stacked list under a rule.

### Panels

- **Top action items** — numbered priority, control title, one muted meta line
  (`framework · domain`), a right-aligned severity chip, and a real CTA
  (`Add evidence →`) replacing the inert "No evidence yet" string.
- **Recent activity** — capped `min-h`, compact empty state with icon + one
  explanatory sentence + a CTA that actually generates activity.
- **Domain gap analysis** — worst-first (already correct), collapsed to the top 5
  with a client-side `Show all N domains` toggle. No new query.

---

## 4. Signature element — the readiness ring

**One** memorable device, and the risk budget is spent entirely here:
`ProgressRing`, an SVG arc that replaces the linear bar on the framework card and
carries the percentage in its centre.

Why a ring is on-brief rather than decorative:

- It collapses two elements (number + bar) into one, which is what removes the
  dead space — the layout fix and the signature element are the *same* decision.
- An instrument panel reads as gauges. A compliance console is an instrument
  panel. This is the one place the "audit instrument" metaphor earns literal form.
- It is squared off nowhere else: `stroke-linecap: butt`, not round. A rounded
  cap would read as a fitness app. This is a record, not a workout.

Motion: `stroke-dashoffset` animates from empty to value once, on mount, over
`--dharma-motion-base` (150ms) — the system cap, not the 600–800ms swell that
would make it feel like a marketing page. Under `prefers-reduced-motion: reduce`
the token collapses to 1ms automatically, and the component additionally renders
the final offset directly so there is no flash.

---

## 5. Self-critique against generic-AI-design tells

The brief named three. Assessed honestly:

**1. Cream background + terracotta accent.**
Dharma is guilty as charged, and knowingly so. This is not a tell that went
unnoticed — it was raised, documented in `0_DESIGN_SYSTEM.md` § Provenance, and
overruled by the owner. It is out of scope to fix here and re-raising it would be
re-litigating a settled decision. **Flagged, not changed.**

**2. Near-black + acid green.** Not present. Actively rejected in the vault's own
provenance note as "the default costume of the category" (Vanta/Drata/Wiz).

**3. Broadsheet hairlines.** Present — the system is explicitly hairline-and-flat
with no elevation scale. The mitigation here is that hairlines are *load-bearing
rather than ornamental*: they separate rows in the domain list where the eye
needs a rule, and they are removed from the framework card's internal "Key gaps"
divider, which existed only to fill space.

**A fourth tell the brief did not name, which this dashboard had:**
*uniform emphasis.* Twelve identical "high gap" chips, three identical action
rows, six equal-height cards. Generated interfaces default to treating every item
as equally important because ranking requires a judgement the generator does not
have. The fix is the substance of this pass: severity-ranked ordering, top-5
collapse, coloured rules only on cards that are actually at risk, and a hero
number that is genuinely larger than what surrounds it.

---

## 6. Deliberately **not** built, and why

**`Sparkline` / `trendDelta`.** The brief asks for a trend line per framework and
an additive `previousStatusPercent` Prisma field to feed it.

There is **no time-series source in the schema.** No compliance snapshot model
exists; the only historical record is `AuditLog`, and reconstructing per-framework
readiness over time from audit rows is a feature, not a re-skin — explicitly
outside this pass ("do not invent new business logic").

Adding a nullable `previousStatusPercent` column with no writer would ship a
permanently-`null` field, a `Sparkline` that never renders, and a migration that
exists to satisfy a checklist. That is dead code with a schema change attached.

**Neither the column nor the component is built.** The ring's centre is sized to
accept a delta glyph later without relayout. Building this properly needs a
`FrameworkReadinessSnapshot` model plus a scheduled BullMQ job — a separate,
justified piece of work.

---

## 7. Severity — one implementation, not two in agreement

The brief proposed computing severity server-side *and* keeping a parallel client
helper, then unit-testing that the two agree.

Two implementations that must be kept in sync is the defect, not the safeguard.
This pass ships **one** pure module, `src/lib/compliance/severity.ts`, imported by
both `dashboardRouter.getStats` and the client components. Agreement is
structural. The tests assert thresholds and boundary behaviour once.

This also resolves a live bug: `page.tsx` banded at 50/80 while
`FrameworkProgressCards.tsx` banded at 60/80, so the same framework could read
"At risk" in one place and "Needs work" in another. Canonical thresholds:

| Severity | Range | Label |
|---|---|---|
| `critical` | 0–49% | At risk |
| `partial` | 50–79% | Needs work |
| `healthy` | 80–99% | On track |
| `complete` | 100% | Complete |

One further rule the old code lacked: a framework with **zero controls** bands
`critical`, not `complete`. `0/0` is unevidenced, and reporting 100% ready for
an unpopulated framework in front of an auditor is the worst thing this
dashboard could do. The seeded org has exactly such a framework ("SOC 2",
0 of 0 controls), so this is live, not hypothetical.

---

## 8. Data defects found while rendering — not fixed here

Three, all seed-data problems surfaced by the redesign rather than caused by it.

**1. Duplicate ISO 27001 frameworks.** `ISO 27001` (v2022, 4 controls) and
`ISO 27001:2022` (v1.0, 24 controls) are separate rows with different control
counts. The version chip makes them distinguishable; it does not merge them.

**2. Duplicate SOC 2 frameworks — not in the original brief.** `SOC 2`
(version "Type II", **0 controls**) and `SOC 2 Type II` (v1.0, 28 controls). The
same defect as the ISO pair, and the empty one is worse: it renders a framework
card carrying no data at all.

**3. Placeholder "Test Control" rows.** Four of the top five action items are
literally titled `Test Control`, all on ISO 27001 · Access Control. The list is
correctly ranked; the underlying titles are seed placeholders.

All three are marked `// TODO(data):` at the render site and belong in the
framework seed, not in the UI.

---

## 9. Known cosmetic inconsistency, deliberately left

The Domain gap analysis legend renders the `--seq-1 … --seq-5` ramp, which is
**blue** — a cold hue sitting inside a warm-paper page. It reads as foreign.

It is retained because `634c9ec` kept `--seq-*` and `--chart-*` as HSL on
purpose: Warm Paper supplies no sequential ramp, and four categorical roles
cannot encode a five-step magnitude scale. Dropping or recolouring it here would
also change the crosswalk heatmap and the dashboard charts that share it. That
is a design-system decision, not a dashboard one, and it wants its own pass.
