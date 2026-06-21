"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Dashboard request failed
          </CardTitle>
          <CardDescription>
            Retry the request after confirming your session and service containers are healthy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={reset}>Retry</Button>
        </CardContent>
      </Card>
    </div>
  );
}
