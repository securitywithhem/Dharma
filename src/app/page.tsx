import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { 
  ArrowRight, 
  Database, 
  LockKeyhole, 
  Server, 
  Sparkles, 
  Cpu, 
  ShieldCheck, 
  Clock, 
  ChevronRight, 
  Globe, 
  Layers 
} from "lucide-react";
import { authOptions } from "@/server/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    title: "On-Premises AI Engine",
    description: "Run nomic-embed-text and Llama 3 8B models locally via Ollama. 100% vector similarity mapping, completely offline.",
    icon: Cpu,
    color: "from-amber-500/10 to-orange-500/10 border-orange-500/20"
  },
  {
    title: "Tamper-Evident Logs",
    description: "Every action is linked in a cryptographic SHA-256 chain. The verification engine catches any database tampering instantly.",
    icon: LockKeyhole,
    color: "from-indigo-500/10 to-blue-500/10 border-indigo-500/20"
  },
  {
    title: "Bypassed Object Store",
    description: "Evidence is uploaded directly to your self-hosted MinIO bucket via secure 15-minute presigned URLs.",
    icon: Server,
    color: "from-emerald-500/10 to-teal-500/10 border-emerald-500/20"
  },
  {
    title: "Auditor Token Portals",
    description: "Create time-bound, read-only dashboard access tokens for external compliance regulators with automatic expiration.",
    icon: ShieldCheck,
    color: "from-purple-500/10 to-pink-500/10 border-purple-500/20"
  },
  {
    title: "DPDP Act Alignment",
    description: "Pre-loaded consent structures, notice requirements, and principal rights mapped directly to Indian regulations.",
    icon: Globe,
    color: "from-red-500/10 to-rose-500/10 border-red-500/20"
  },
  {
    title: "Full tRPC & Prisma Stack",
    description: "End-to-end TypeScript type-safety mapping the Postgres database layer directly to the React components.",
    icon: Database,
    color: "from-sky-500/10 to-cyan-500/10 border-sky-500/20"
  }
];

export default async function LandingPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      {/* Background gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] pointer-events-none -z-10 opacity-30 dark:opacity-40">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.15),transparent_60%)]" />
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-amber-600 to-orange-500 flex items-center justify-center text-white font-bold shadow-md shadow-orange-500/20">
              D
            </div>
            <span className="font-semibold text-lg tracking-tight">Dharma</span>
          </div>

          <nav className="hidden md:flex items-center space-x-6 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#architecture" className="hover:text-foreground transition-colors">Architecture</a>
            <a href="https://github.com/sickn33/antigravity-awesome-skills" target="_blank" className="hover:text-foreground transition-colors">Documentation</a>
          </nav>

          <div className="flex items-center space-x-3">
            <Link href="/auth/signin">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link href="/auth/signin">
              <Button size="sm" className="bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-700 hover:to-orange-600 text-white border-0 shadow-sm shadow-orange-500/10">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 lg:py-28 text-center flex-1 flex flex-col items-center justify-center relative">
        <div className="max-w-4xl space-y-8 animate-fade-in">
          <div className="inline-flex items-center space-x-2 bg-muted/60 backdrop-blur border border-border/50 px-3 py-1 rounded-full text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
            <Badge className="bg-gradient-to-r from-amber-600 to-orange-500 text-white hover:from-amber-600 hover:to-orange-500 border-0" variant="secondary">
              v1.0 Ready
            </Badge>
            <span>Self-hosted compliance for Indian MSMEs</span>
            <ChevronRight className="h-3 w-3" />
          </div>

          <div className="space-y-6">
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/80 leading-none">
              Your compliance infrastructure.<br />
              <span className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 bg-clip-text text-transparent">
                Completely self-hosted.
              </span>
            </h1>
            <p className="max-w-2xl mx-auto text-base sm:text-lg text-muted-foreground leading-relaxed">
              Dharma delivers an enterprise-ready compliance backbone directly inside your boundary. Mapped to the **DPDP Act 2023**, **ISO 27001**, and **SOC 2** — powered by local vector embedding similarity search and cryptographic proof logs.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/auth/signin?callbackUrl=/dashboard">
              <Button size="lg" className="h-12 px-6 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-700 hover:to-orange-600 text-white border-0 shadow-lg shadow-orange-500/20 gap-2">
                Enter Workspace
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="outline" className="h-12 px-6 border-border/60 hover:bg-muted/50 backdrop-blur">
                Explore Features
              </Button>
            </a>
          </div>

          {/* Quick stats / Trust badges */}
          <div className="pt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              100% Data Sovereignty
            </div>
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-indigo-500" />
              SHA-256 Chain Auditing
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-500" />
              Local AI processing
            </div>
          </div>
        </div>
      </section>

      {/* Bento Grid Features Section */}
      <section id="features" className="container mx-auto px-4 py-20 border-t border-border/40 bg-muted/20">
        <div className="max-w-3xl mx-auto text-center space-y-4 mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Built to secure enterprise compliance</h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            Every component of Dharma is optimized to run locally within Docker containers, keeping user data and compliance artifacts secure and verifiable.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ title, description, icon: Icon, color }) => (
            <Card key={title} className={`border border-border/60 bg-card/60 backdrop-blur hover:border-primary/20 transition-all hover:-translate-y-1 duration-200 group overflow-hidden`}>
              <CardHeader className="relative">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full group-hover:scale-110 transition-transform" />
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed mt-2">{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-background py-8 text-center text-xs text-muted-foreground/60 mt-auto">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <div className="h-5 w-5 rounded bg-gradient-to-tr from-amber-600 to-orange-500 flex items-center justify-center text-white font-bold text-[10px]">
              D
            </div>
            <span className="font-semibold text-foreground/80">Dharma MSME Compliance Platform</span>
          </div>
          <p>© {new Date().getFullYear()} Dharma. All data remains within your self-hosted host boundary.</p>
        </div>
      </footer>
    </div>
  );
}
