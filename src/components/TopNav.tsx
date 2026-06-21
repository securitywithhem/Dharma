"use client";

import { ShieldCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";

export function TopNav() {
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Compliance command center
          </div>
          <p className="text-sm font-medium text-foreground">
            {session?.user?.email ?? "Signed-in workspace"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="default">{session?.user?.role ?? "VIEWER"}</Badge>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
