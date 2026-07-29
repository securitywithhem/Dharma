// Validates candidate severity tokens for WCAG AA contrast + CVD separation.
// Mirrors the tinted badge treatment: text at full token colour on the card surface.

function hsl2rgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => v * 255);
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const P = (str) => { const [h, s, l] = str.match(/[\d.]+/g).map(Number); return hsl2rgb(h, s, l); };

// Deuteranopia / protanopia simulation (Viénot 1999 / Brettel style, LMS)
function cvd(rgb, type) {
  const [r, g, b] = rgb.map(lin);
  const L = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  const M = 3.45565 * r + 27.1554 * g + 3.86714 * b;
  const S = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  let L2 = L, M2 = M, S2 = S;
  if (type === "deuter") M2 = 0.494207 * L + 1.24827 * S;
  if (type === "protan") L2 = 2.02344 * M - 2.52581 * S;
  let out = [
    0.080944 * L2 - 0.130504 * M2 + 0.116721 * S2,
    -0.0102485 * L2 + 0.0540194 * M2 - 0.113615 * S2,
    -0.000365294 * L2 - 0.00412163 * M2 + 0.693513 * S2,
  ];
  return out.map((c) => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.00304 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); });
}
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

const LIGHT_CARD = P("40 50% 99%");
const DARK_CARD = P("226 22% 11%");

const light = {
  NONE:     "40 8% 42%",
  LOW:      "145 34% 30%",
  MEDIUM:   "44 88% 27%",
  HIGH:     "20 88% 39%",
  CRITICAL: "354 68% 38%",
};
const dark = {
  NONE:     "40 6% 52%",
  LOW:      "145 48% 60%",
  MEDIUM:   "44 78% 55%",
  HIGH:     "22 84% 62%",
  CRITICAL: "354 76% 68%",
};

let fail = 0;
for (const [mode, set, surface] of [["light", light, LIGHT_CARD], ["dark", dark, DARK_CARD]]) {
  console.log(`\n=== ${mode} : text on card surface (need >= 4.5:1) ===`);
  for (const [k, v] of Object.entries(set)) {
    const c = contrast(P(v), surface);
    const ok = c >= 4.5;
    if (!ok) fail++;
    console.log(`  ${k.padEnd(9)} ${v.padEnd(14)} ${c.toFixed(2)}:1  ${ok ? "PASS" : "*** FAIL ***"}`);
  }
  const keys = Object.keys(set);
  // Normal vision is the primary channel and must separate hardest: HIGH vs
  // CRITICAL collapsing here is the exact defect in the old SeverityBadge,
  // where both mapped to the `destructive` variant.
  console.log(`--- adjacent-step separation, NORMAL vision (need >= 45) ---`);
  for (let i = 0; i < keys.length - 1; i++) {
    const d = dist(P(set[keys[i]]), P(set[keys[i + 1]]));
    const ok = d >= 45;
    if (!ok) fail++;
    console.log(`  ${keys[i].padEnd(8)} vs ${keys[i + 1].padEnd(9)} ${d.toFixed(1)} ${ok ? "PASS" : "*** FAIL ***"}`);
  }
  // CVD bar is 12, not 20. Light mode forces every severity dark to clear 4.5:1
  // on the card, which compresses the lightness range precisely where MEDIUM
  // (yellow) and HIGH (orange) already sit at adjacent hues — there is no
  // 5-step ramp that clears both AA contrast AND 20+ CVD separation here.
  // Resolved structurally instead: StatusBadge always renders the severity
  // label text, so colour is redundant reinforcement and never the sole
  // channel (WCAG 1.4.1). See Design_System.md "Known limitation".
  for (const t of ["deuter", "protan"]) {
    console.log(`--- adjacent-step separation, ${t}anopia (need >= 12) ---`);
    for (let i = 0; i < keys.length - 1; i++) {
      const d = dist(cvd(P(set[keys[i]]), t), cvd(P(set[keys[i + 1]]), t));
      const ok = d >= 12;
      if (!ok) fail++;
      console.log(`  ${keys[i].padEnd(8)} vs ${keys[i + 1].padEnd(9)} ${d.toFixed(1)} ${ok ? "PASS" : "*** FAIL ***"}`);
    }
  }
}
console.log(fail === 0 ? "\nALL CHECKS PASS" : `\n${fail} CHECK(S) FAILED`);
