/**
 * Dharma "Warm Paper" — Tailwind extend block.
 *
 * This is an `extend` fragment, NOT a config. Merge it into the real
 * tailwind.config.ts under `theme.extend`; do not replace that file.
 *
 * Canonical source: Dharma-Knowledge-OS/0_DESIGN_SYSTEM.md
 * Token definitions:  src/styles/tokens.css
 *
 * Every value below resolves through a CSS custom property rather than
 * inlining the hex, so tokens.css stays the single place a colour changes.
 * Because the tokens are hex (not HSL channels), Tailwind's `/opacity`
 * modifier does NOT work on these utilities — `bg-dharma-accent/10` will not
 * compile to a translucent fill. Use the paired `-tint` / `-bg` token instead.
 * That is the reason the semantic roles ship an explicit `bg` value.
 */

module.exports = {
  colors: {
    dharma: {
      // Surfaces
      bg: "var(--dharma-surface-bg)",
      surface: "var(--dharma-surface-surface)",
      "surface-hover": "var(--dharma-surface-hover)",
      border: "var(--dharma-surface-border)",
      "border-strong": "var(--dharma-surface-border-strong)",

      // Text
      ink: "var(--dharma-text-primary)",
      "ink-secondary": "var(--dharma-text-secondary)",
      "ink-muted": "var(--dharma-text-muted)",
      "ink-inverse": "var(--dharma-text-inverse)",

      // Accent — one filled element per screen
      accent: "var(--dharma-accent-base)",
      "accent-hover": "var(--dharma-accent-hover)",
      "accent-tint": "var(--dharma-accent-tint-bg)",
      "accent-on-tint": "var(--dharma-accent-on-tint)",

      // Semantic roles — always used as {role}-bg + {role}-text together
      success: "var(--dharma-success-base)",
      "success-bg": "var(--dharma-success-bg)",
      "success-text": "var(--dharma-success-text)",

      warning: "var(--dharma-warning-base)",
      "warning-bg": "var(--dharma-warning-bg)",
      "warning-text": "var(--dharma-warning-text)",

      danger: "var(--dharma-danger-base)",
      "danger-bg": "var(--dharma-danger-bg)",
      "danger-text": "var(--dharma-danger-text)",

      info: "var(--dharma-info-base)",
      "info-bg": "var(--dharma-info-bg)",
      "info-text": "var(--dharma-info-text)",
    },
  },

  fontFamily: {
    // Wordmark + h1/h2 ONLY. Never a table header, button, or label.
    voice: "var(--dharma-font-voice)",
    sans: "var(--dharma-font-sans)",
    mono: "var(--dharma-font-mono)",
  },

  borderRadius: {
    "dharma-sm": "var(--dharma-radius-sm)",
    "dharma-md": "var(--dharma-radius-md)",
    "dharma-lg": "var(--dharma-radius-lg)",
  },

  transitionDuration: {
    "dharma-fast": "var(--dharma-motion-fast)", // 120ms — colour, opacity
    "dharma-base": "var(--dharma-motion-base)", // 150ms — transform, size
  },

  transitionTimingFunction: {
    dharma: "var(--dharma-motion-ease)",
  },
};

/* ---------------------------------------------------------------------------
 * USAGE — an ISO 27001 control row, as rendered by
 * src/app/dashboard/frameworks/[id]/ControlTable.tsx.
 *
 * Shows all four rules at once: mono for the control ID, the tint+dark-text
 * badge pairing, the hairline border, and NO accent anywhere — the accent on
 * this screen is spent on the "Add evidence" primary CTA in the page header,
 * so every control row must stay neutral.
 *
 *   <tr className="border-b border-dharma-border transition-colors
 *                  duration-dharma-fast ease-dharma
 *                  hover:bg-dharma-surface-hover">
 *
 *     <td className="px-3 py-2 font-mono text-[13px] text-dharma-ink-secondary">
 *       A.8.1.1
 *     </td>
 *
 *     <td className="px-3 py-2 text-dharma-ink">
 *       Inventory of information assets
 *     </td>
 *
 *     <td className="px-3 py-2">
 *       {/* tint bg + dark text on tint — never bg-dharma-success + white *\/}
 *       <span className="inline-flex items-center gap-1.5 rounded-dharma-sm
 *                        border border-dharma-border px-2 py-0.5
 *                        bg-dharma-success-bg text-dharma-success-text">
 *         <span className="h-1.5 w-1.5 rounded-full bg-dharma-success" />
 *         Implemented
 *       </span>
 *     </td>
 *
 *     {/* Secondary, not muted: this is operational text a user must read. *\/}
 *     <td className="px-3 py-2 text-right tabular-nums text-dharma-ink-secondary">
 *       3 evidence
 *     </td>
 *   </tr>
 * ------------------------------------------------------------------------- */
