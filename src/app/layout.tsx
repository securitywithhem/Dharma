import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { getServerSession } from "next-auth";
import { Providers } from "@/app/providers";
import { authOptions } from "@/server/auth";
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
  title: "Dharma",
  description:
    "Self-hosted compliance management for DPDP, ISO 27001, and SOC 2 evidence operations."
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} min-h-screen font-sans antialiased`}>
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
