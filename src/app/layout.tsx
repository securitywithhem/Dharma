import type { Metadata } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { Providers } from "@/app/providers";
import { authOptions } from "@/server/auth";
import { getTenantTheme, tenantThemeStyleTag } from "@/lib/theme/getTenantTheme";
import "@/styles/globals.css";

// Inter Tight carries the dense UI: slightly narrower than Inter, so control
// titles and table cells fit without shrinking below a readable size.
const sans = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

// Fraunces is the brand voice — an optical serif used only for page titles and
// the marketing surface. `opsz` is what makes it hold up at display sizes;
// `SOFT`/`WONK` are dialled down so it reads considered, not decorative.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"]
});

// Identifiers that must be compared character-by-character: control IDs
// (A.8.1.1), evidence hashes, CVEs, API keys.
const mono = JetBrains_Mono({
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
