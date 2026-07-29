/**
 * The Dharma design tokens, resolved to literal hex for PDF rendering.
 *
 * WHY THIS FILE EXISTS
 * `@react-pdf/renderer` builds its own layout tree and has no CSS custom
 * properties, no Tailwind, and no stylesheet cascade -- `StyleSheet.create`
 * takes literal colour values only. So the PDF documents cannot consume
 * `hsl(var(--primary))` the way every screen component does.
 *
 * Before this file, each of the four report documents carried its own copy of
 * those literals, and all four had drifted to `#D97706` -- the saffron primary
 * retired with the old UI docs. Every exported report therefore rendered in a
 * colour that appears nowhere else in the product. One shared source is the
 * fix; four copies is what caused the drift.
 *
 * KEEPING IT HONEST
 * These are the LIGHT-MODE token values from src/styles/globals.css converted
 * from HSL to hex. A printed report has no dark mode. When a token changes
 * there, change it here too -- there is no build-time link between the two, by
 * necessity rather than by choice.
 */

export const pdfPalette = {
  /** --background: warm chalk paper. */
  background: "#F8F6F1",
  /** --card: the panel surface reports lay content on. */
  surface: "#FEFDFB",
  /** --muted: table header fills, recessed rows. */
  surfaceMuted: "#EEECE7",
  /** --border: hairline rules. */
  border: "#DFDAD3",

  /** --foreground: ink. */
  text: "#181C2A",
  /** --secondary-foreground: sub-headings. */
  textSecondary: "#272C3F",
  /** --muted-foreground: captions, metadata, footers. */
  textMuted: "#5C6170",

  /** --primary: indigo dye. Section rules, the wordmark, key figures. */
  primary: "#2D3A80",
  /** --primary-foreground: text set on a primary fill. */
  primaryText: "#F8F6F1",

  /** --success / --warning / --critical, plus print-weight tints. */
  success: "#396A4E",
  successTint: "#E4F1EA",
  warning: "#BE892D",
  warningTint: "#F7EEDE",
  critical: "#B63D2B",
  criticalTint: "#F8E5E2",
} as const;

/**
 * The `--severity-*` ramp, one entry per member of the Prisma `Severity` enum.
 *
 * The ramp is deliberately identical in hue to the on-screen one: an auditor
 * reads a finding in the console and then again in the exported PDF, and the
 * two must agree. Only the tint lightness differs, tuned for paper rather than
 * a backlit surface.
 */
export const pdfSeverity = {
  NONE: { fg: "#746E63", tint: "#ECEBE9" },
  LOW: { fg: "#326748", tint: "#E4F2E9" },
  MEDIUM: { fg: "#816108", tint: "#F7F0DE" },
  HIGH: { fg: "#BB460C", tint: "#F7E7DE" },
  CRITICAL: { fg: "#A31F2C", tint: "#F7DEE1" },
} as const;

export type PdfSeverity = keyof typeof pdfSeverity;
