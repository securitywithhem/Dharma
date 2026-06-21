import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const authErrorCopy: Record<string, string> = {
  AccessDenied: "The provider rejected the login attempt or the account lacks permission.",
  Configuration: "Authentication providers are not fully configured in the environment.",
  Verification: "The email verification request is invalid or has expired."
};

export default function AuthErrorPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  const errorCode = searchParams?.error ?? "Configuration";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg border-destructive/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-2xl">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            Authentication error
          </CardTitle>
          <CardDescription>
            {authErrorCopy[errorCode] ?? "An unexpected authentication error occurred."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Link href="/auth/signin">
            <Button>Return to sign in</Button>
          </Link>
          <span className="text-sm text-muted-foreground">Error code: {errorCode}</span>
        </CardContent>
      </Card>
    </main>
  );
}
