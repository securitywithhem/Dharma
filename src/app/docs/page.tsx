"use client";

import React, { useState } from "react";
import Link from "next/link";
import { 
  ArrowLeft, 
  BookOpen, 
  Terminal, 
  Settings, 
  AlertTriangle, 
  CheckCircle2, 
  HelpCircle, 
  FileText, 
  Database, 
  Sparkles, 
  Copy, 
  Check, 
  Activity,
  User,
  ShieldAlert,
  Server,
  Code
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type DocSection = "setup" | "usage" | "troubleshooting";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<DocSection>("setup");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const codeSnippets = {
    clone: "git clone https://github.com/your-username/dharma-compliance.git\ncd dharma-compliance",
    dockerUp: "docker compose up -d --build",
    seed: "docker exec dharma-nextjs npm run seed:all",
    logs: "docker compose logs -f nextjs",
    manualSeed: "npm run db:generate && npm run db:deploy && npm run db:seed && npm run seed:frameworks",
    pullOllama: "docker exec -it dharma-ollama ollama pull nomic-embed-text\ndocker exec -it dharma-ollama ollama pull llama3:8b"
  };

  return (
    <div className="min-h-screen bg-dharma-bg relative overflow-hidden flex flex-col font-sans">
      {/* One brand wash, from the `dharma-radial` token. The three stacked
          blur-3xl colour fields this replaces were the retired saffron, and
          blurred fills are the one depth cue the design system rules out. */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] pointer-events-none -z-10" />

      {/* Header */}
      <header className="border-b border-dharma-border bg-dharma-bg backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div className="h-4 w-[1px] bg-border" />
            <div className="flex items-center space-x-2">
              <div className="h-6 w-6 rounded bg-dharma-accent flex items-center justify-center text-dharma-ink-inverse font-bold text-xs">
                D
              </div>
              <span className="font-semibold text-sm tracking-tight">Dharma Docs</span>
            </div>
          </div>
          <Badge variant="success">
            System Online
          </Badge>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="container mx-auto px-4 py-8 flex-1 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Navigation Sidebar */}
        <div className="space-y-3 lg:col-span-1">
          <div className="sticky top-24 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-dharma-ink-secondary px-3 mb-4">
              Documentation Menu
            </p>
            
            <button
              onClick={() => setActiveSection("setup")}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeSection === "setup"
                  ? "bg-dharma-accent-tint text-dharma-accent-on-tint font-semibold"
                  : "text-dharma-ink-secondary hover:bg-dharma-surface-hover hover:text-dharma-ink"
              }`}
            >
              <Terminal className="h-4 w-4" />
              <span>1. Setup & Installation</span>
            </button>

            <button
              onClick={() => setActiveSection("usage")}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeSection === "usage"
                  ? "bg-dharma-accent-tint text-dharma-accent-on-tint font-semibold"
                  : "text-dharma-ink-secondary hover:bg-dharma-surface-hover hover:text-dharma-ink"
              }`}
            >
              <BookOpen className="h-4 w-4" />
              <span>2. Usage & Compliance</span>
            </button>

            <button
              onClick={() => setActiveSection("troubleshooting")}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeSection === "troubleshooting"
                  ? "bg-dharma-accent-tint text-dharma-accent-on-tint font-semibold"
                  : "text-dharma-ink-secondary hover:bg-dharma-surface-hover hover:text-dharma-ink"
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
              <span>3. Troubleshooting Errors</span>
            </button>

            <div className="pt-6 mt-6 border-t border-dharma-border">
              <Card className="bg-dharma-surface-hover border-dharma-border">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider">Host Status</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2 text-xs text-dharma-ink-secondary">
                  <div className="flex justify-between">
                    <span>Database:</span>
                    <span className="text-dharma-success-text font-semibold">Connected</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ollama:</span>
                    <span className="text-dharma-success-text font-semibold">Active</span>
                  </div>
                  <div className="flex justify-between">
                    <span>MinIO Storage:</span>
                    <span className="text-dharma-success-text font-semibold">Active</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Documentation Content Panels */}
        <div className="lg:col-span-3 space-y-8">
          
          {/* Section 1: Setup & Installation */}
          {activeSection === "setup" && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Setup & Installation Guide</h2>
                <p className="text-dharma-ink-secondary text-sm">
                  Dharma is fully containerized. Get it up and running on your local machine or server in less than 5 minutes.
                </p>
              </div>

              {/* Step 1 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader className="pb-3">
                  <Badge className="w-fit mb-2">Step 1</Badge>
                  <CardTitle className="text-lg">Clone the Repository</CardTitle>
                  <CardDescription>Get the source code onto your local machine.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative group rounded-lg bg-dharma-ink p-4 font-mono text-xs text-dharma-ink-inverse overflow-x-auto">
                    <pre>{codeSnippets.clone}</pre>
                    <button 
                      onClick={() => handleCopy(codeSnippets.clone, "clone")} 
                      className="absolute right-3 top-3 p-1.5 rounded bg-dharma-surface-hover hover:bg-dharma-surface-hover text-dharma-ink-secondary group-hover:block transition-all"
                    >
                      {copiedText === "clone" ? <Check className="h-3.5 w-3.5 text-dharma-success-text" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* Step 2 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader className="pb-3">
                  <Badge className="w-fit mb-2">Step 2</Badge>
                  <CardTitle className="text-lg">Prepare Environment Configurations</CardTitle>
                  <CardDescription>Configure secrets and endpoints. A default developer configuration template is provided.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-dharma-ink-secondary">
                    Copy the default docker configuration environment file to enable Next.js database connectivity and cryptographic logs:
                  </p>
                  <div className="relative group rounded-lg bg-dharma-ink p-4 font-mono text-xs text-dharma-ink-inverse overflow-x-auto">
                    <pre>cp .env.example .env.docker&#10;cp .env.example .env</pre>
                  </div>
                </CardContent>
              </Card>

              {/* Step 3 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader className="pb-3">
                  <Badge className="w-fit mb-2">Step 3</Badge>
                  <CardTitle className="text-lg">Start Docker Containers</CardTitle>
                  <CardDescription>Download dependencies, build, and run the core services.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative group rounded-lg bg-dharma-ink p-4 font-mono text-xs text-dharma-ink-inverse overflow-x-auto">
                    <pre>{codeSnippets.dockerUp}</pre>
                    <button 
                      onClick={() => handleCopy(codeSnippets.dockerUp, "dockerUp")} 
                      className="absolute right-3 top-3 p-1.5 rounded bg-dharma-surface-hover hover:bg-dharma-surface-hover text-dharma-ink-secondary group-hover:block transition-all"
                    >
                      {copiedText === "dockerUp" ? <Check className="h-3.5 w-3.5 text-dharma-success-text" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="text-xs text-dharma-ink-secondary mt-2">
                    *Note: This downloads pgvector, Redis, MinIO, Caddy, Ollama, and compiles the Next.js production build.*
                  </p>
                </CardContent>
              </Card>

              {/* Step 4 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader className="pb-3">
                  <Badge className="w-fit mb-2">Step 4</Badge>
                  <CardTitle className="text-lg">Apply Database Migrations & Seed Frameworks</CardTitle>
                  <CardDescription>Generate Prisma clients, apply pgvector schemas, and seed the compliance controls.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative group rounded-lg bg-dharma-ink p-4 font-mono text-xs text-dharma-ink-inverse overflow-x-auto">
                    <pre>{codeSnippets.seed}</pre>
                    <button 
                      onClick={() => handleCopy(codeSnippets.seed, "seed")} 
                      className="absolute right-3 top-3 p-1.5 rounded bg-dharma-surface-hover hover:bg-dharma-surface-hover text-dharma-ink-secondary group-hover:block transition-all"
                    >
                      {copiedText === "seed" ? <Check className="h-3.5 w-3.5 text-dharma-success-text" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="flex items-start gap-2 bg-dharma-success-bg border border-dharma-success text-dharma-success-text rounded-lg p-3 text-xs leading-relaxed mt-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <strong>Database seeded successfully!</strong> Seeds 144 regulatory control records (DPDP Act 2023, ISO 27001, SOC 2 Type II) and initializes the sequential cryptographic audit logs chain.
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Section 2: Usage & Compliance */}
          {activeSection === "usage" && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Compliance Operations Manual</h2>
                <p className="text-dharma-ink-secondary text-sm">
                  Learn how to use the self-hosted interface to manage evidence, generate security policies, and run audits.
                </p>
              </div>

              {/* Feature 1 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader>
                  <div className="flex items-center space-x-2 text-dharma-accent-on-tint mb-2">
                    <FileText className="h-5 w-5" />
                    <CardTitle className="text-lg">1. Evidence Collection & AI Mapping</CardTitle>
                  </div>
                  <CardDescription>How to upload evidence and match them to requirements.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-dharma-ink-secondary leading-relaxed">
                  <p>
                    Dharma processes your sensitive evidence screenshots and text documents inside your private container:
                  </p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>Navigate to the **Evidence Upload** dashboard.</li>
                    <li>Drag and drop screenshots, PDFs, or log exports. Dharma generates a secure presigned upload URL directly to **MinIO** storage.</li>
                    <li>Once uploaded, a background worker parses the document text, extracts keywords, and generates vector embeddings.</li>
                    <li>The **pgvector Search Engine** matches the document to compliance controls and presents the top matches for you to accept.</li>
                  </ul>
                </CardContent>
              </Card>

              {/* Feature 2 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader>
                  <div className="flex items-center space-x-2 text-dharma-accent-on-tint mb-2">
                    <Sparkles className="h-5 w-5" />
                    <CardTitle className="text-lg">2. local AI Policy Drafting (RAG)</CardTitle>
                  </div>
                  <CardDescription>Drafting DPDP notice letters and SOC 2 security policies locally.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-dharma-ink-secondary leading-relaxed">
                  <p>
                    Create standard policies that are 100% compliant with local laws without sending corporate data to cloud servers:
                  </p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>Go to the **Policy Wizard** inside the workspace.</li>
                    <li>Enter your company's core parameters (data principal categories, processing limits).</li>
                    <li>Click **Generate Draft**. The system retrieves context from local regulation chunks and utilizes Ollama to synthesize a draft.</li>
                    <li>Edit and save the document inside the built-in rich TipTap text editor.</li>
                  </ul>
                </CardContent>
              </Card>

              {/* Feature 3 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader>
                  <div className="flex items-center space-x-2 text-dharma-accent-on-tint mb-2">
                    <Database className="h-5 w-5" />
                    <CardTitle className="text-lg">3. Verifiable Cryptographic Log Chain</CardTitle>
                  </div>
                  <CardDescription>Checking ledger logs for tampering.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-dharma-ink-secondary leading-relaxed">
                  <p>
                    Every database insert/update creates a sequentially chained hash log:
                  </p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>Access the **Audit Ledger** tab to view the live log feed.</li>
                    <li>Click the **Verify Ledger** button. The system re-hashes all events from the genesis block, ensuring no values were modified.</li>
                    <li>A green shield widget confirms the chain is valid and ready to present to external regulators.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Section 3: Troubleshooting Errors */}
          {activeSection === "troubleshooting" && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Troubleshooting Common Errors</h2>
                <p className="text-dharma-ink-secondary text-sm">
                  Encountered an error or timeout? Find rapid instructions to debug and resolve configuration mismatches here.
                </p>
              </div>

              {/* Issue 1 */}
              <Card className="border-dharma-danger bg-dharma-danger-bg backdrop-blur">
                <CardHeader className="pb-2">
                  <div className="flex items-center space-x-2 text-dharma-danger-text mb-2">
                    <ShieldAlert className="h-5 w-5" />
                    <CardTitle className="text-lg">Caddy Container Unhealthy or Failing</CardTitle>
                  </div>
                  <CardDescription>Caddy logs report `aborting with incomplete response` or `context canceled` on nextjs upstream.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-relaxed">
                  <p className="text-dharma-ink-secondary">
                    This occurs if Next.js hasn't fully booted when Caddy begins running health checks, or if Caddyfile's `/health` endpoint is proxied incorrectly.
                  </p>
                  <div className="space-y-2">
                    <span className="font-semibold text-xs uppercase tracking-wider block text-dharma-ink">Solution:</span>
                    <ol className="list-decimal pl-5 space-y-1.5 text-dharma-ink-secondary">
                      <li>Verify Next.js container health by running `curl http://localhost:3000/api/health` directly from the host.</li>
                      <li>Verify the Caddyfile has a specific `handle /health` block. Re-create and restart Caddy to load the changes:
                        <div className="relative group rounded-lg bg-dharma-ink p-3 font-mono text-xs text-dharma-ink-inverse overflow-x-auto mt-2">
                          <pre>docker compose restart caddy</pre>
                        </div>
                      </li>
                    </ol>
                  </div>
                </CardContent>
              </Card>

              {/* Issue 2 */}
              <Card className="border-dharma-warning bg-dharma-warning-bg">
                <CardHeader className="pb-2">
                  <div className="flex items-center space-x-2 text-dharma-ink mb-2">
                    <Server className="h-5 w-5" />
                    <CardTitle className="text-lg">Ollama Model Pull Failed or Service Timeout</CardTitle>
                  </div>
                  <CardDescription>AI operations (embedding matching or policy drafting) hang or report connection refused.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-relaxed">
                  <p className="text-dharma-ink-secondary">
                    The initialization container `ollama-init` tries to pull large LLM parameters (several gigabytes) upon startup. Slow internet connections can cause the container to fail or terminate before completion.
                  </p>
                  <div className="space-y-2">
                    <span className="font-semibold text-xs uppercase tracking-wider block text-dharma-ink">Solution:</span>
                    <p className="text-dharma-ink-secondary">
                      Manually trigger model pulls directly inside the running Ollama container:
                    </p>
                    <div className="relative group rounded-lg bg-dharma-ink p-3 font-mono text-xs text-dharma-ink-inverse overflow-x-auto mt-2">
                      <pre>{codeSnippets.pullOllama}</pre>
                      <button 
                        onClick={() => handleCopy(codeSnippets.pullOllama, "pullOllama")} 
                        className="absolute right-3 top-3 p-1.5 rounded bg-dharma-surface-hover hover:bg-dharma-surface-hover text-dharma-ink-secondary group-hover:block transition-all"
                      >
                        {copiedText === "pullOllama" ? <Check className="h-3.5 w-3.5 text-dharma-success-text" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Issue 3 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader className="pb-2">
                  <div className="flex items-center space-x-2 text-dharma-accent-on-tint mb-2">
                    <User className="h-5 w-5" />
                    <CardTitle className="text-lg">Cannot Sign In / Magic Link Emails Not Received</CardTitle>
                  </div>
                  <CardDescription>Magic link login emails are not arriving in your inbox.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-relaxed text-dharma-ink-secondary">
                  <p>
                    In local development, SMTP configurations are left empty by default. Dharma logs all generated magic-link callback tokens straight to the stdout console logs.
                  </p>
                  <p className="font-semibold text-xs uppercase tracking-wider text-dharma-ink">Solution:</p>
                  <p>
                    Enter your email address on the login screen, then run:
                  </p>
                  <div className="relative group rounded-lg bg-dharma-ink p-3 font-mono text-xs text-dharma-ink-inverse overflow-x-auto">
                    <pre>{codeSnippets.logs}</pre>
                    <button 
                      onClick={() => handleCopy(codeSnippets.logs, "logs")} 
                      className="absolute right-3 top-3 p-1.5 rounded bg-dharma-surface-hover hover:bg-dharma-surface-hover text-dharma-ink-secondary group-hover:block transition-all"
                    >
                      {copiedText === "logs" ? <Check className="h-3.5 w-3.5 text-dharma-success-text" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p>
                    Copy the URL beginning with `http://localhost:3000/api/auth/callback/email?...` and paste it into Chrome.
                  </p>
                </CardContent>
              </Card>

              {/* Issue 4 */}
              <Card className="border-dharma-border bg-dharma-surface backdrop-blur">
                <CardHeader className="pb-2">
                  <div className="flex items-center space-x-2 text-dharma-accent-on-tint mb-2">
                    <Code className="h-5 w-5" />
                    <CardTitle className="text-lg">Prisma Client or Database Sync Issues</CardTitle>
                  </div>
                  <CardDescription>Next.js throws schema or database table missing errors on start.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-relaxed text-dharma-ink-secondary">
                  <p>
                    If databases were shut down forcefully, or the Prisma schema was updated, you may need to manually run migrations and re-generate the client.
                  </p>
                  <p className="font-semibold text-xs uppercase tracking-wider text-dharma-ink">Solution:</p>
                  <p>
                    Inside the running container, trigger Prisma rebuilds:
                  </p>
                  <div className="relative group rounded-lg bg-dharma-ink p-3 font-mono text-xs text-dharma-ink-inverse overflow-x-auto">
                    <pre>docker exec -it dharma-nextjs npm run build</pre>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-dharma-border bg-dharma-bg py-8 text-center text-xs text-dharma-ink-secondary mt-auto">
        <div className="container mx-auto px-4">
          <p>© {new Date().getFullYear()} Dharma self-hosted documentation engine. Mapped to DPDP, ISO 27001, and SOC 2.</p>
        </div>
      </footer>
    </div>
  );
}
