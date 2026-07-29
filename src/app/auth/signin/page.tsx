"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getProviders, signIn } from "next-auth/react";
import type { ClientSafeProvider } from "next-auth/react";
import { Chrome, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DharmaMark } from "@/components/brand/DharmaMark";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") ?? "/dashboard";
  const [providers, setProviders] = useState<Record<string, ClientSafeProvider>>({});
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void getProviders().then((result) => setProviders(result ?? {}));
  }, []);

  const googleEnabled = useMemo(() => Boolean(providers.google), [providers]);
  const emailEnabled = useMemo(() => Boolean(providers.email), [providers]);

  async function handleProviderSignIn(providerId: string, emailValue?: string) {
    setIsSubmitting(true);
    await signIn(providerId, {
      callbackUrl,
      email: emailValue
    });
    setIsSubmitting(false);
  }

  const canSubmitEmail = emailEnabled && !isSubmitting && email.length > 0;

  return (
    <main className="surface-paper relative flex min-h-screen items-center justify-center bg-dharma-bg px-4 py-10">
      {/* A single soft indigo wash from the top, replacing the amber radials
          left over from the retired warm identity. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" />

      <div className="relative w-full max-w-[26rem]">
        <div className="mb-7 flex flex-col items-center text-center">
          <DharmaMark className="h-9 w-9 text-dharma-accent-on-tint" />
          <h1 className="mt-3 font-display text-2xl font-semibold tracking-[-0.02em]">
            Sign in to Dharma
          </h1>
          <p className="mt-1.5 text-data text-dharma-ink-secondary">
            Enter your compliance workspace.
          </p>
        </div>

        <Card className="border border-dharma-border">
          <CardContent className="space-y-5 p-5">
            <Button
              size="lg"
              className="w-full"
              disabled={!googleEnabled || isSubmitting}
              onClick={() => handleProviderSignIn("google")}
            >
              <Chrome />
              {googleEnabled ? "Continue with Google" : "Google sign-in not configured"}
            </Button>

            <div className="flex items-center gap-3">
              <hr className="rule flex-1" />
              <span className="text-micro uppercase tracking-[0.12em] text-dharma-ink-secondary">
                or
              </span>
              <hr className="rule flex-1" />
            </div>

            {/* A real <form>: the previous version was two loose controls, so
                pressing Enter in the email field did nothing. */}
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmitEmail) void handleProviderSignIn("email", email);
              }}
            >
              <label className="text-data font-medium" htmlFor="email">
                Magic link
              </label>
              <div className="flex gap-2">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="founder@company.in"
                  disabled={!emailEnabled || isSubmitting}
                  aria-describedby={!emailEnabled ? "email-help" : undefined}
                />
                <Button type="submit" variant="outline" disabled={!canSubmitEmail}>
                  <Mail />
                  Send
                </Button>
              </div>
              {!emailEnabled && (
                <p id="email-help" className="text-micro text-dharma-ink-secondary">
                  Magic links activate once SMTP variables are set.
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-micro text-dharma-ink-secondary">
          Trouble signing in?{" "}
          <Link
            className="font-medium text-dharma-accent-on-tint underline-offset-4 hover:underline"
            href="/auth/error"
          >
            Review auth errors
          </Link>
        </p>
      </div>
    </main>
  );
}
