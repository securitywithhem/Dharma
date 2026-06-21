import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowRight, Database, LockKeyhole, Server, Sparkles } from "lucide-react";
import { authOptions } from "@/server/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const featureCards = [
  {
    title: "Container-first",
    description: "Postgres, Redis, MinIO, Ollama, Caddy, and Next.js wired for self-hosted delivery.",
    icon: Server
  },
  {
    title: "Typed backend",
    description: "tRPC, Prisma, and NextAuth keep route contracts, database models, and sessions aligned.",
    icon: Database
  },
  {
    title: "Audit-ready",
    description: "Foundation support for tamper-evident logs, evidence storage, and organization-scoped access.",
    icon: LockKeyhole
  }
];

export default async function LandingPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative overflow-hidden bg-background">
      <div className="absolute inset-0 -z-10 bg-dharma-radial" />
      <section className="container flex min-h-screen flex-col justify-center py-20">
        <div className="max-w-4xl space-y-8">
          <Badge className="w-fit" variant="warning">
            Dharma Phase 0.1
          </Badge>
          <div className="space-y-5">
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
              Compliance infrastructure built to stay inside your own boundary.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Dharma gives Indian teams a self-hosted backbone for frameworks, policy operations,
              evidence collection, and audit trails without pushing sensitive data to a hosted SaaS.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/auth/signin">
              <Button size="lg" className="gap-2">
                Enter workspace
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/auth/signin?callbackUrl=/dashboard">
              <Button size="lg" variant="outline">
                Sign in
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {featureCards.map(({ description, icon: Icon, title }) => (
            <Card key={title} className="border-primary/10 bg-card/80 backdrop-blur">
              <CardHeader>
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Foundation layer aligned to the repo spec.
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
