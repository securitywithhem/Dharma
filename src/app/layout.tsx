import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { Providers } from "@/app/providers";
import { authOptions } from "@/server/auth";
import { getTenantTheme, tenantThemeStyleTag } from "@/lib/theme/getTenantTheme";
import "@/styles/globals.css";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans"
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono"
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
      <body className={`${sans.variable} ${mono.variable} min-h-screen font-sans antialiased`}>
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
