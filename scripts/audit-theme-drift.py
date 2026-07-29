#!/usr/bin/env python3
"""Report components that bypass the Dharma design tokens.

This is the grep gate for docs/theme-migration-checklist.md. It flags three
kinds of drift:

  * raw Tailwind palette classes (bg-emerald-500, text-slate-400, ...)
  * literal hex colours
  * hand-written `dark:` overrides, which are only ever needed when the base
    class was not a token -- the tokens carry their own .dark values

Exit status is 1 when any non-exempt drift remains, so this can run in CI.

Exemptions are files that render OUTSIDE the app's CSS-variable scope (PDF
documents, standalone HTML exports, transactional email) and therefore cannot
reference custom properties. They still must track the token VALUES; see the
"Legitimate exemptions" table in the checklist.
"""

import os
import re
import sys

PALETTE = re.compile(
    r"\b(?:hover:|focus:|active:|group-hover:|disabled:|dark:)*"
    r"(?:bg|text|border|from|via|to|ring|fill|stroke|divide|outline|shadow|"
    r"accent|decoration|placeholder)-"
    r"(?:slate|gray|zinc|neutral|stone|blue|green|red|orange|amber|yellow|"
    r"purple|violet|indigo|emerald|rose|sky|teal|cyan|lime|fuchsia|pink)-"
    r"[0-9]{2,3}\b"
)
HEX = re.compile(r"#[0-9A-Fa-f]{6}\b")

# Only a `dark:` carrying a LEGACY value is drift. `dark:text-foreground` is
# legitimate: a few places genuinely need a different *token* per mode -- e.g.
# a sequential ramp runs light-to-dark in one mode and dark-to-light in the
# other, so the step at which the label flips is not the same step.
DARK = re.compile(
    r"\bdark:(?:hover:|focus:|active:)*"
    r"(?:(?:bg|text|border|from|via|to|ring|fill|stroke|divide|outline|shadow|"
    r"accent|decoration|placeholder)-"
    r"(?:slate|gray|zinc|neutral|stone|blue|green|red|orange|amber|yellow|"
    r"purple|violet|indigo|emerald|rose|sky|teal|cyan|lime|fuchsia|pink)-"
    r"[0-9]{2,3}|\[#[0-9A-Fa-f]{3,8}\])"
)

# Escape hatch for the rare literal that is correct and already explained in a
# neighbouring comment. Put `theme-drift-allow` on the offending line.
ALLOW = "theme-drift-allow"

# Files permitted to carry literal colour, with the reason.
EXEMPT = {
    "src/lib/pdf/": "@react-pdf/renderer has no CSS custom properties",
    "src/workers/auditorPackage.ts": "standalone HTML export, opened outside the app",
    "src/server/auth.ts": "transactional email; clients strip CSS variables",
    "src/styles/globals.css": "token definitions themselves",
    # Warm Paper (2026-07-29). Hex is the mandated format here, not drift —
    # see Dharma-Knowledge-OS/0_DESIGN_SYSTEM.md. Contrast for these values is
    # gated separately by scripts/validate-dharma-contrast.js.
    "src/styles/tokens.css": "token definitions themselves",
    # A deliberately inverted editorial surface that stays ink-dark in both
    # modes, so the light/dark tokens do not apply to it. Its palette is
    # declared once as named constants at the top of the file and is
    # pigment-consistent with the console (indigo, neem).
    "src/app/page.tsx": "marketing surface; fixed ink palette, declared as named constants",
}

# Prose about colour is not colour. Without this, a comment explaining why a
# legacy class was removed re-trips the gate that removal was meant to clear.
LINE_COMMENT = re.compile(r"^\s*(//|\*|/\*)")

# The .dark block in globals.css and the theme toggle are the intended
# mechanism, not drift.
DARK_OK = {
    "src/styles/globals.css",
    "src/components/ThemeToggle.tsx",
    "src/app/providers.tsx",
}


def exemption_for(path):
    for prefix, reason in EXEMPT.items():
        if path.startswith(prefix):
            return reason
    return None


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "src"
    findings, exempted = [], []

    for dirpath, _, filenames in os.walk(root):
        for name in sorted(filenames):
            if not name.endswith((".tsx", ".ts", ".css")):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as handle:
                source = "\n".join(
                    line for line in handle.read().splitlines()
                    if not LINE_COMMENT.match(line) and ALLOW not in line
                )

            palette = len(PALETTE.findall(source))
            hexes = len(HEX.findall(source))
            dark = 0 if path in DARK_OK else len(DARK.findall(source))
            if not (palette or hexes or dark):
                continue

            reason = exemption_for(path)
            row = (palette + hexes + dark, palette, hexes, dark, path, reason)
            (exempted if reason else findings).append(row)

    findings.sort(reverse=True)

    if findings:
        print(f"{'tot':>4} {'pal':>4} {'hex':>4} {'dark':>4}  file")
        for total, palette, hexes, dark, path, _ in findings:
            print(f"{total:>4} {palette:>4} {hexes:>4} {dark:>4}  {path}")
        print(
            f"\n{len(findings)} file(s) still bypass the design tokens "
            f"({sum(r[1] for r in findings)} palette, "
            f"{sum(r[2] for r in findings)} hex, "
            f"{sum(r[3] for r in findings)} dark:)."
        )
    else:
        print("No design-token drift outside the documented exemptions.")

    if exempted:
        print("\nExempt (literal colour is correct here):")
        for _, _, hexes, _, path, reason in sorted(exempted, key=lambda r: r[4]):
            print(f"  {path} — {hexes} hex — {reason}")

    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
