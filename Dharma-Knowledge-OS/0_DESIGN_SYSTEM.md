---
title: Design System — Warm Paper
folder: (vault root)
tags: [dharma, design, ui, tokens, accessibility]
source_docs:
  - 00_START_HERE/Dharma_Master_Context.md
  - 00_START_HERE/Product_Principles.md
  - 03_PRODUCT/Feature_Backlog.md
  - 03_PRODUCT/Roadmap.md
  - 04_TECHNICAL/Design_System.md
  - 04_TECHNICAL/Security_Architecture.md
  - 06_MARKETING/Brand_Message.md
  - src/styles/tokens.css
  - tailwind.config.dharma.js
last_updated: 2026-07-29
status: adopted (overrides prior decline — see Provenance)
---

# Design System — "Warm Paper"

The visual language for every Dharma surface. Implemented by
[`src/styles/tokens.css`](../src/styles/tokens.css) and
[`tailwind.config.dharma.js`](../tailwind.config.dharma.js).

Companion to [[Design_System]] (`04_TECHNICAL/`), which this **supersedes** for
all colour, type, and motion decisions. That file remains authoritative for
component *contracts* and for the history of how we got here.

---

## Provenance — read this before "correcting" the palette

This palette was proposed on 2026-07-29, **assessed and declined** the same day,
and then **adopted by explicit owner override** after the decline was presented
with its costs. That sequence matters: the objections below were not overlooked,
they were overruled. Do not re-litigate them as if they were new discoveries.

The doc set the original brief cited — `1_PRD.md`, `2_TRD.md`, `3_APP_FLOW.md`,
`4_UI_UX_DESIGN.md`, `5_BACKEND_SCHEMA.md`, `6_IMPLEMENTATION_PLAN.md` — **does
not exist in this vault** and did not when the brief was written. Those files
were retired with `obsidian-vaults/Dharma-Project/` in commit `9d28729`
(recoverable from git history). Screen-specific guidance below is therefore
grounded in the live route tree and in the vault docs that do exist, not in
those filenames.

In particular: the brief instructed that a line reading *"dark theme, green/blue
accents"* in `4_UI_UX_DESIGN.md` be repointed here. **There is no such line to
update.** The phrase came from `UI:UX.md` and read "*assume* dark theme,
green/blue accents" — a placeholder, in a file already retired. No edit was
made. See [[Design_System]] § Provenance.

### Why warm paper, and not the dark direction

Two prior proposals argued for a dark-first console — one on jade `#2F9E6E` +
brass `#C9A227`, one implicitly on navy + amber. Both were declined on taste
before they were declined on evidence:

- **Dark navy + amber is the default costume of the category.** Vanta, Drata,
  Secureframe, Wiz, Snyk, and roughly every security dashboard shipped since
  2021 converge on it. Adopting it makes Dharma look like a clone of the
  incumbents it is positioned against (see [[Competitor_Analysis]]).
- **Compliance work is reading work.** Auditors and compliance leads live in
  dense tables for hours. A warm, high-reflectance paper ground at 14:1 body
  contrast is a better long-session reading surface than a dark ground where
  every white glyph blooms.
- **Paper is the honest metaphor.** The artefact Dharma produces is a record —
  evidence, control statements, an audit package. The product should look like
  the thing it makes.

---

## Palette

Hex values are fixed and are not to be adjusted for contrast. Where a pair
falls short, the **usage rule** is constrained instead — see § Accessibility
reconciliations. All ratios below are measured, not asserted.

### Surfaces

| Token | Hex | Role |
|---|---|---|
| `--dharma-surface-bg` | `#EFEBE2` | Page canvas |
| `--dharma-surface-surface` | `#F8F6F0` | Cards, panels, table headers |
| `--dharma-surface-hover` | `#F1ECE1` | Row / nav hover only |
| `--dharma-surface-border` | `#DDD5C4` | Default 1px hairline |
| `--dharma-surface-border-strong` | `#C9BFA8` | Section dividers |

### Text

| Token | Hex | On `surface` | On `bg` |
|---|---|---|---|
| `--dharma-text-primary` | `#231C1B` | **15.50:1** AAA | 14.08:1 AAA |
| `--dharma-text-secondary` | `#6E6156` | **5.54:1** AA | 5.03:1 AA |
| `--dharma-text-muted` | `#9C9186` | 2.85:1 **fails** | 2.59:1 **fails** |
| `--dharma-text-inverse` | `#FBEEE6` | — | 4.81:1 on accent |

### Accent — one, used sparingly

| Token | Hex | Notes |
|---|---|---|
| `--dharma-accent-base` | `#B2481D` | 4.81:1 with inverse text — AA |
| `--dharma-accent-hover` | `#9A3D18` | 6.05:1 with inverse text — AA |
| `--dharma-accent-tint-bg` | `#F1E1D6` | — |
| `--dharma-accent-on-tint` | `#7C3218` | 7.08:1 on tint — AAA |

**Budget: one accent-filled element per rendered screen.** Spend it on the
primary CTA, *or* the active nav item, *or* one hero metric — never two.

### Semantic roles

Always `{role}-bg` + `{role}-text` together. Never a saturated fill with white
text. The `-base` value is for non-text marks only: dot indicators, chart
series, progress fills, 1px rules.

| Role | Base | Tint bg | Text on tint | Ratio |
|---|---|---|---|---|
| success | `#4F7A5C` | `#E4EBE3` | `#3C5E45` | 6.01:1 AA |
| warning | `#B87F2E` | `#F1E4CD` | `#8C5E1F` | 4.48:1 **large-text only** |
| danger | `#A8483A` | `#F0DEDA` | `#7C3529` | 6.74:1 AA |
| info | `#5C6E7D` | `#E6EAED` | `#445561` | 6.39:1 AA |

---

## Typography

- **Voice (serif — Newsreader or Fraunces):** wordmark, `h1`, `h2` page titles.
  Nothing else. Not table headers, not buttons, not labels, not body copy.
- **Sans (Public Sans):** all UI. Controls, tables, body, navigation, forms.
- **Mono (IBM Plex Mono):** strings compared character-by-character — audit log
  entries, control IDs (`A.8.1.1`), evidence hashes, ARNs, CVEs, API keys.

`Fraunces` is already loaded as `--font-display` in
[`src/app/layout.tsx`](../src/app/layout.tsx), so the serif requirement is met
without adding a font. The sans and mono faces change (`Inter Tight` → Public
Sans, `JetBrains Mono` → IBM Plex Mono).

---

## The five restraint rules

1. **No gradients, shadows, blur, or glow.** Flat surfaces, hairline borders.
   There is deliberately no elevation scale and no shadow token.
2. **One accent per screen.** See budget above.
3. **Tint + dark text for every status treatment.** Never saturated fill +
   white text.
4. **Density over decoration** on power-user screens — controls, evidence,
   vulnerabilities, audit log.
5. **Motion capped at 120–150ms ease-out.** Nothing loops except genuine
   indeterminate progress. Icons are optional, not the default.

---

## Accessibility reconciliations

Three pairs in the approved spec do not clear WCAG AA as-specified. The hex is
fixed, so each is resolved by constraining **where the token may be used**.
These are requirements, not suggestions.

1. **`--dharma-text-muted` fails AA at any size** (2.85:1 / 2.59:1). Permitted
   only for disabled control labels (exempt under 1.4.3), decorative glyphs,
   and ornament duplicated elsewhere. Any string a user must read to operate
   the product — placeholder, helper text, table meta, timestamp, empty state —
   uses `--dharma-text-secondary`.
2. **The warning pair is 4.48:1** — 0.02 short of the 4.5 normal-text
   threshold, conforming only under the large-text rule. Warning chips and
   warning helper text must render ≥18.66px bold or ≥24px regular. At the
   default micro chip size this pair is **non-conforming**; enforced in the
   Badge primitive.
3. **Neither border token reaches 3:1** (1.35:1, 1.53:1), so under 1.4.11 they
   cannot be the sole indicator of an interactive boundary. Input idle borders,
   checkbox outlines, and focus rings use `--dharma-text-secondary` or
   `--dharma-accent-base`.

---

## Accepted costs

Adopting hex tokens carries three consequences that were surfaced before
adoption and accepted by the owner. They are recorded here so a future session
reads them as decisions, not as bugs.

1. **Per-tenant white-label colour override stops working.**
   `hexToHslChannels()` in
   [`src/lib/theme/getTenantTheme.ts`](../src/lib/theme/getTenantTheme.ts)
   injects `H S% L%` channel triplets to override `--primary`/`--ring` at
   runtime. Hex tokens cannot receive a channel triplet, so the injection is
   inert. This is a **behavioural** regression in a shipped Phase 8 feature,
   not a styling one.
2. **The severity ramp is dropped; the data-viz ramps are retained.**
   The CVD-validated five-step `--severity-*` scale is gone — five steps now
   map onto four roles (`NONE`→neutral, `LOW`→info, `MEDIUM`→warning,
   `HIGH`→danger, `CRITICAL`→danger). **`HIGH` and `CRITICAL` therefore share a
   hue**, separated only by border weight and font weight. The always-rendered
   text label is what keeps this WCAG 1.4.1-conforming, so it is now
   load-bearing and must never become icon-only.

   `--chart-*` and `--seq-*` were **kept** in `globals.css`, deliberately.
   Warm Paper specifies no categorical or sequential ramp, and there is nothing
   to map them onto — four semantic roles cannot encode a five-step magnitude
   scale. Dropping them would have left the crosswalk `OverlapHeatmap` and the
   dashboard charts unreadable, which is a functional regression, not a
   restyle. They remain HSL-channel tokens and remain machine-validated.
3. **`src/components/ui/` is rewritten, not reskinned.** Every shadcn primitive
   reads `hsl(var(--background))`. `dharma-*` utilities do not satisfy that
   contract, so the primitives are rebuilt against the new tokens.

Also note: because the tokens are hex, Tailwind's `/opacity` modifier does not
work on `dharma-*` colour utilities. `bg-dharma-accent/10` will not compile to
a translucent fill — which is why each semantic role ships an explicit `bg`.

---

## Phase 8 white-label caveat

Per [[Feature_Backlog]] and [[Roadmap]], Phase 8 lets an organisation supply
its own brand colour and logo for customer-facing surfaces — the audit portal,
auditor evidence packages, and generated PDF reports.

**The tokens in this document are the DEFAULT, Dharma-owned theme. They are not
a constraint on tenant white-label output.** A tenant that sets a brand colour
is expected to override the accent on those surfaces; the semantic roles,
however, must never be tenant-overridable — an auditor must not encounter a
product where "compliant" and "critical finding" have been recoloured into each
other. That separation is a security-adjacent property, not a cosmetic one:
[[Security_Architecture]] treats white-label CSS as an untrusted-input surface.

Given cost (1) above, the runtime override path is currently inert. Until it is
re-implemented against hex tokens, Phase 8 white-labelling is **documentation-
accurate but functionally disabled**.

---

## Vault cross-references

The screen inventory the original brief referenced (`3_APP_FLOW.md`,
`4_UI_UX_DESIGN.md`) does not exist. This system governs the live route tree
instead, in migration order:

**Shared primitives** — `src/components/ui/`: `button`, `card`, `badge`,
`input`, `dialog`, `select`, `table`, `progress`, `checkbox`, `label`, `form`,
`separator`, `skeleton`, `status-badge`.

**Layout shell** — [`src/app/layout.tsx`](../src/app/layout.tsx),
dashboard nav, [`src/app/onboarding/layout.tsx`](../src/app/onboarding/layout.tsx),
[`src/app/audit/portal/layout.tsx`](../src/app/audit/portal/layout.tsx).

**Per-screen**, matching the Key Screens list preserved in [[Design_System]]:

| Screen | Routes | Governing vault doc |
|---|---|---|
| Marketplace | `dashboard/marketplace`, `.../[id]`, `dashboard/admin/marketplace`, `dashboard/publisher/*` | [[Feature_Backlog]] |
| Connectors | `dashboard/settings/connectors`, `dashboard/endpoints`, `.../[id]` | [[System_Architecture]] |
| Pentest | `dashboard/pentests`, `.../[id]`, `dashboard/vulnerabilities`, `.../triage` | [[Risk_Management]] |
| AI Chat | `src/components/ai-advisor/*` | [[Requirements]] |
| Enterprise Settings | `dashboard/settings/enterprise/{sso,roles,audit-log,white-label}`, `.../api-keys`, `.../webhooks` | [[Authorization]], [[Security_Architecture]] |
| MSSP Dashboard | `dashboard/mssp`, `.../[orgId]`, `.../grants` | [[Target_Customers]] |
| Frameworks & Controls | `dashboard/frameworks`, `.../[id]`, `.../readiness`, `dashboard/controls/[id]`, `dashboard/cross-walk` | [[ISO_27001]], [[SOC_2]] |
| Evidence | `dashboard/evidence`, `.../[id]` | [[Audit_Process]] |
| Audit portal (external) | `audit/portal` | [[Audit_Process]] |

Migration progress is tracked in
[`docs/theme-migration-checklist.md`](../docs/theme-migration-checklist.md).
