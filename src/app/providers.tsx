"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TRPCReactProvider } from "@/hooks/trpc";
// StripeProvider is deliberately NOT mounted here. Mounting it app-wide made
// every route load js.stripe.com on first paint, for a context no component
// outside billing consumes. Billing screens wrap themselves in it instead.

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
        <TRPCReactProvider>
          {children}
        </TRPCReactProvider>
        <Toaster richColors position="bottom-right" />
      </ThemeProvider>
    </SessionProvider>
  );
}
