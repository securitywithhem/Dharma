#!/usr/bin/env node
/**
 * WCAG contrast gate for the Dharma token pairs, light and dark.
 *
 * Why this and not only an axe-core run: axe checks the pages you happen to
 * drive it over, and a theme change touches pairs that only appear in a state
 * you did not visit (a disabled control, an error toast, the fifth severity
 * step). Checking the token pairs directly covers the whole system, and it runs
 * without a browser or a database. Use it alongside axe, not instead of it.
 *
 * Tinted treatments are checked as they actually render: a `bg-success/12`
 * wash is composited over the card surface first, then the text is measured
 * against that composite -- measuring against the pure token would report a
 * contrast the user never sees.
 *
 * Usage: node scripts/validate-token-contrast.js
 */

const fs = require("fs");
const path = require("path");

const CSS = fs.readFileSync(
  path.join(__dirname, "..", "src", "styles", "globals.css"),
  "utf8",
);

/** Pull `--name: H S% L%;` triples out of the :root and .dark blocks. */
function readTokens(blockName) {
  const start = CSS.indexOf(blockName);
  if (start === -1) throw new Error(`block ${blockName} not found`);
  // Walk to the matching closing brace of the block.
  let depth = 0;
  let i = CSS.indexOf("{", start);
  const from = i;
  for (; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = CSS.slice(from, i);
  const out = {};
  const re = /--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g;
  let m;
  while ((m = re.exec(body))) {
    out[m[1]] = [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
  }
  return out;
}

function hslToRgb([h, s, l]) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const lin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

function contrast(fg, bg) {
  const a = lum(fg);
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Composite `fg` at `alpha` over `bg` -- what a /12 style wash actually paints. */
function over(fg, bg, alpha) {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
}

// [label, textToken, surfaceToken, minimum, tintAlpha?]
// 4.5 = AA normal text. 3.0 = AA large text and non-text UI (WCAG 1.4.11):
// status dots, chart fills, and progress bars are graphical objects, and each
// is paired with a text label so colour is never the sole channel.
const PAIRS = [
  ["body on page", "foreground", "background", 4.5],
  ["body on card", "foreground", "card", 4.5],
  ["muted text on page", "muted-foreground", "background", 4.5],
  ["muted text on card", "muted-foreground", "card", 4.5],
  ["secondary text", "secondary-foreground", "secondary", 4.5],
  ["primary button", "primary-foreground", "primary", 4.5],
  ["destructive button", "destructive-foreground", "destructive", 4.5],
  ["accent chip", "accent-foreground", "accent", 4.5],
  ["success solid", "success-foreground", "success", 4.5],
  ["warning solid", "warning-foreground", "warning", 4.5],
  ["critical solid", "critical-foreground", "critical", 4.5],
  ["info solid", "info-foreground", "info", 4.5],

  // Tinted badges: text at full strength on a 12% wash of itself over the card.
  // The wash comes from the base role token; the label from its -on-tint
  // variant. `washToken` names the colour that paints the background.
  ["success badge", "success-on-tint", "card", 4.5, 0.12, "success"],
  ["warning badge", "warning-on-tint", "card", 4.5, 0.12, "warning"],
  ["critical badge", "critical-on-tint", "card", 4.5, 0.12, "critical"],
  ["info badge", "info-on-tint", "card", 4.5, 0.12, "info"],
  ["primary badge", "primary", "card", 4.5, 0.1, "primary"],
  ["accent badge", "accent-on-tint", "card", 4.5, 0.1, "accent"],

  // Severity chips render the same way, one per Prisma Severity member.
  ["severity NONE", "severity-none-on-tint", "card", 4.5, 0.12, "severity-none"],
  ["severity LOW", "severity-low-on-tint", "card", 4.5, 0.12, "severity-low"],
  ["severity MEDIUM", "severity-medium-on-tint", "card", 4.5, 0.12, "severity-medium"],
  ["severity HIGH", "severity-high-on-tint", "card", 4.5, 0.12, "severity-high"],
  ["severity CRITICAL", "severity-critical-on-tint", "card", 4.5, 0.14, "severity-critical"],

  // Non-text: hairlines and graphical fills.
  ["border on page", "border", "background", 1.2],
  ["chart-1 fill", "chart-1", "card", 3.0],
  ["chart-2 fill", "chart-2", "card", 3.0],
  ["chart-3 fill", "chart-3", "card", 3.0],
  ["chart-4 fill", "chart-4", "card", 3.0],
  ["chart-5 fill", "chart-5", "card", 3.0],
];

// The crosswalk heatmap sets a numeric label directly on a seq step, so those
// are text pairs, not fills. Which token wins flips per mode because the ramp
// runs light-to-dark in one and dark-to-light in the other.
const SEQ_LABEL = {
  light: [
    ["seq-1 label", "foreground", "seq-1"],
    ["seq-2 label", "foreground", "seq-2"],
    ["seq-3 label", "foreground", "seq-3"],
    ["seq-4 label", "background", "seq-4"],
    ["seq-5 label", "background", "seq-5"],
  ],
  dark: [
    ["seq-1 label", "foreground", "seq-1"],
    ["seq-2 label", "foreground", "seq-2"],
    ["seq-3 label", "foreground", "seq-3"],
    ["seq-4 label", "foreground", "seq-4"],
    ["seq-5 label", "background", "seq-5"],
  ],
};

let failures = 0;

for (const mode of ["light", "dark"]) {
  const t = readTokens(mode === "light" ? ":root" : ".dark");
  // The .dark block only overrides; anything it omits inherits from :root.
  const base = mode === "dark" ? { ...readTokens(":root"), ...t } : t;

  console.log(`\n=== ${mode.toUpperCase()} ===`);
  const rows = [
    ...PAIRS,
    ...SEQ_LABEL[mode].map(([l, f, b]) => [l, f, b, 4.5]),
  ];

  for (const [label, fgName, bgName, min, alpha, washName] of rows) {
    if (!base[fgName] || !base[bgName]) {
      console.log(`  ${label.padEnd(20)} SKIP (token missing)`);
      continue;
    }
    const fg = hslToRgb(base[fgName]);
    const bgPure = hslToRgb(base[bgName]);
    const wash = washName ? hslToRgb(base[washName]) : fg;
    const bg = alpha ? over(wash, bgPure, alpha) : bgPure;
    const ratio = contrast(fg, bg);
    const ok = ratio >= min;
    if (!ok) failures++;
    console.log(
      `  ${label.padEnd(20)} ${ratio.toFixed(2).padStart(6)}:1  need ${min
        .toFixed(1)
        .padStart(4)}  ${ok ? "PASS" : "FAIL"}`,
    );
  }
}

console.log(
  failures === 0
    ? "\nALL CHECKS PASS"
    : `\n${failures} PAIR(S) BELOW THRESHOLD`,
);
process.exit(failures === 0 ? 0 : 1);
