"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { TRPCReactProvider } from "@/hooks/trpc";

export function Providers({
  children,
  session
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
