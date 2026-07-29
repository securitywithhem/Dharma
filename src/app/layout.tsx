import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { Providers } from "@/app/providers";
import { authOptions } from "@/server/auth";
import { getTenantTheme, tenantThemeStyleTag } from "@/lib/theme/getTenantTheme";
// Warm Paper tokens load BEFORE globals.css so globals can consume them and
// so a later rule always wins on specificity ties.
// Spec: Dharma-Knowledge-OS/0_DESIGN_SYSTEM.md
import "@/styles/tokens.css";
import "@/styles/globals.css";

// Public Sans carries the dense UI — the Warm Paper spec's UI face. It is a
// touch wider than the Inter Tight it replaces, so table cells and control
// titles have slightly less room; the 11–13px micro/meta/data steps in
// tailwind.config.ts are what keep them fitting.
const sans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

// Fraunces is the brand voice — the Warm Paper spec names "Newsreader or
// Fraunces", and Fraunces was already loaded, so no font is added. Reserved for
// the wordmark and h1/h2 page titles ONLY: not table headers, buttons, labels,
// or body copy. `opsz` is what makes it hold up at display sizes; `SOFT`/`WONK`
// are dialled down so it reads considered, not decorative.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"]
});

// Identifiers that must be compared character-by-character: audit log entries,
// control IDs (A.8.1.1), evidence hashes, ARNs, CVEs, API keys. IBM Plex Mono
// per the Warm Paper spec, replacing JetBrains Mono.
const mono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Dharma | Compliance Status",
  description:
    "Self-hosted compliance workspace for Indian startups and MSMEs preparing for DPDP, ISO 27001, and SOC 2."
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  // Phase 8 Part 2 — white-label: middleware forwards the Host header;
  // verified custom domains get their org's CSS variable overrides injected
  // server-side. Null theme = default Dharma styling.
  const tenantHost =
    headers().get("x-dharma-tenant-host") ?? headers().get("host");
  const tenantTheme = await getTenantTheme(tenantHost);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {tenantTheme && (
          <style
            id="tenant-theme"
            dangerouslySetInnerHTML={{ __html: tenantThemeStyleTag(tenantTheme) }}
          />
        )}
      </head>
      <body
        className={`${sans.variable} ${display.variable} ${mono.variable} min-h-screen font-sans antialiased`}
      >
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
