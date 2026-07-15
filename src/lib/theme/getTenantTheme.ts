// Phase 8 Part 2 — tenant-aware white-label theme resolution (TRD: "dynamic
// CSS variables and logo URL stored in OrganizationSettings, served by a
// tenant-aware SSR middleware").
//
// Division of labor: middleware.ts (edge runtime — no Prisma) forwards the
// incoming Host as x-dharma-tenant-host; this server-only helper does the DB
// lookup during SSR in the root layout and returns the CSS custom properties
// to inject. Only VERIFIED custom domains resolve — an unverified domain
// claim must never restyle anything.
import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db";
import { generatePresignedDownloadUrl } from "@/server/minio";
import { logger } from "@/lib/logger";

export const whiteLabelSchema = z.object({
  /** MinIO object key of the uploaded logo. */
  logoKey: z.string().max(512).optional(),
  /** #rgb or #rrggbb. */
  primaryColor: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .optional(),
  customDomain: z
    .string()
    .regex(/^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+$/)
    .optional(),
  customDomainVerified: z.boolean().optional(),
  /**
   * Raw CSS overrides, org-admin supplied, served only on that org's pages.
   * "<" is rejected outright: the value is rendered inside a <style> tag, and
   * allowing "<" would permit a </style><script> breakout — script execution
   * against every member of the org. Valid CSS never needs a literal "<".
   */
  css: z.string().max(20_000).refine((value) => !value.includes("<"), {
    message: "CSS overrides must not contain the '<' character.",
  }).optional(),
});

export type WhiteLabelConfig = z.infer<typeof whiteLabelSchema>;

export function parseStoredWhiteLabel(value: unknown): WhiteLabelConfig | null {
  const parsed = whiteLabelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type TenantTheme = {
  organizationId: string;
  /** CSS custom-property overrides, e.g. { "--primary": "24 96% 53%" }. */
  cssVariables: Record<string, string>;
  logoUrl: string | null;
  rawCss: string | null;
};

function hexToHslChannels(hex: string): string | null {
  const normalized =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized);
  if (!match) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map((c) => parseInt(c, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  // Tailwind/shadcn HSL channel format: "H S% L%".
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Resolves the white-label theme for an incoming Host header. Returns null
 * for the default (non-white-labeled) experience — unknown hosts, unverified
 * domains, or lookup failures all degrade to default styling, never to an
 * error page.
 */
export async function getTenantTheme(
  host: string | null | undefined,
): Promise<TenantTheme | null> {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname || hostname === "localhost") return null;

  try {
    const settings = await prisma.organizationSettings.findFirst({
      where: {
        whiteLabel: { path: ["customDomain"], equals: hostname },
      },
    });
    const config = parseStoredWhiteLabel(settings?.whiteLabel);
    if (!settings || !config || config.customDomainVerified !== true) {
      return null;
    }

    const cssVariables: Record<string, string> = {};
    if (config.primaryColor) {
      const channels = hexToHslChannels(config.primaryColor);
      // Overrides the Phase 0 dark-theme accent variables per-org; the rest
      // of the palette is untouched, so default styling stays intact.
      if (channels) {
        cssVariables["--primary"] = channels;
        cssVariables["--ring"] = channels;
      }
    }

    let logoUrl: string | null = null;
    if (config.logoKey) {
      logoUrl = await generatePresignedDownloadUrl(config.logoKey, 60 * 60);
    }

    return {
      organizationId: settings.organizationId,
      cssVariables,
      logoUrl,
      rawCss: config.css ?? null,
    };
  } catch (error) {
    logger.warn({ err: error, host: hostname }, "tenant theme resolution failed");
    return null;
  }
}

/** Renders the inline <style> payload for the root layout. */
export function tenantThemeStyleTag(theme: TenantTheme): string {
  const vars = Object.entries(theme.cssVariables)
    .map(([key, value]) => `${key}: ${value};`)
    .join(" ");
  const varsBlock = vars ? `:root { ${vars} }` : "";
  return `${varsBlock}\n${theme.rawCss ?? ""}`.trim();
}
