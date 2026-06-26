"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getProviders, signIn } from "next-auth/react";
import type { ClientSafeProvider } from "next-auth/react";
import { Chrome, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(217,119,6,0.12),transparent_35%),linear-gradient(180deg,rgba(255,251,235,0.7),rgba(255,255,255,1))] px-4 dark:bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_30%),linear-gradient(180deg,rgba(41,37,36,0.8),rgba(9,9,11,1))]">
      <Card className="w-full max-w-lg border-primary/10 bg-card/90 backdrop-blur">
        <CardHeader className="space-y-3">
          <CardTitle className="text-3xl">Sign in to Dharma</CardTitle>
          <CardDescription>
            Use Google or a magic link to enter your compliance workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button
            size="lg"
            className="w-full gap-2"
            disabled={!googleEnabled || isSubmitting}
            onClick={() => handleProviderSignIn("google")}
          >
            <Chrome className="h-4 w-4" />
            {googleEnabled ? "Continue with Google" : "Google sign-in not configured"}
          </Button>

          <div className="space-y-3">
            <label className="text-sm font-medium" htmlFor="email">Magic link</label>
            <div className="flex gap-3">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="founder@company.in"
                disabled={!emailEnabled || isSubmitting}
              />
              <Button
                variant="outline"
                disabled={!emailEnabled || isSubmitting || email.length === 0}
                onClick={() => handleProviderSignIn("email", email)}
              >
                <Mail className="mr-2 h-4 w-4" />
                Send
              </Button>
            </div>
            {!emailEnabled ? (
              <p className="text-sm text-muted-foreground">
                Magic links activate once SMTP variables are set.
              </p>
            ) : null}
          </div>

          <p className="text-sm text-muted-foreground">
            Authentication issues route to the dedicated error page.{" "}
            <Link className="font-semibold text-primary" href="/auth/error">
              Review auth errors
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
