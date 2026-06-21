import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-2xl">
            <MailCheck className="h-6 w-6 text-primary" />
            Check your inbox
          </CardTitle>
          <CardDescription>
            If magic links are configured, Dharma has sent a sign-in link to your email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/auth/signin">
            <Button>Back to sign in</Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
