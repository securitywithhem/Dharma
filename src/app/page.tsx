import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowRight, Cpu, Fingerprint, ServerCog, Check } from "lucide-react";
import { authOptions } from "@/server/auth";
import { DharmaMark } from "@/components/brand/DharmaMark";

// Landing is a deliberately dark, self-contained brand surface — it does NOT
// follow the app's light/dark token theme (marketing art direction is its own
// world; the product respects the user's theme, the pitch commits to one mood).
// Explicit values are used throughout for that reason.
//
// The palette is the Indian-pigment identity rendered for ink: warm chalk text
// rather than cold slate, indigo dye for action, haldi for emphasis, neem for
// verified states. The warmth of the text against the ink is what separates
// this from every other dark security landing page.
const ink = "#0e1119";
const panel = "#151925";
const chalk = "#ece8df";
const chalkMuted = "#a8a49b";
const chalkFaint = "#6f6c66";
const indigo = "#5d6fd8";
const indigoSoft = "#9aa5e8";
const neem = "#5cb87f";

const pillars = [
  {
    icon: Cpu,
    title: "Private by architecture",
    body: "Document understanding and control mapping run on a local Ollama model. Your firewall configs, logs, and evidence never touch a third-party cloud.",
  },
  {
    icon: Fingerprint,
    title: "Tamper-evident ledger",
    body: "Every action is SHA-256 hash-chained and externally anchored. A rogue admin can't quietly rewrite compliance history — the chain breaks.",
  },
  {
    icon: ServerCog,
    title: "Your infrastructure, your rules",
    body: "Runs on your servers, your VPC, your region. Data residency isn't a config toggle — it's the default and the only mode.",
  },
];

// The hero visual: the actual audit ledger, chained. This is the product's
// real differentiator rendered as imagery, not stock photography.
const ledger = [
  { event: "EVIDENCE_UPLOADED", hash: "a3f9…c1e0" },
  { event: "CONTROL_MAPPED", hash: "7b2e…9d44" },
  { event: "POLICY_APPROVED", hash: "e14c…2201" },
  { event: "AUDIT_EXPORTED", hash: "f8a1…6b7d" },
];

const frameworks = ["DPDP Act 2023", "ISO/IEC 27001", "SOC 2"];

export default async function LandingPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div
      className="min-h-screen font-sans antialiased"
      style={{ backgroundColor: ink, color: chalk }}
    >
      {/* subtle grid + glow, not blur-blobs */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-50"
        style={{
          background:
            "radial-gradient(60rem 40rem at 78% -10%, rgba(93,111,216,0.16), transparent 60%), radial-gradient(50rem 40rem at 0% 100%, rgba(200,145,43,0.06), transparent 55%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* ---- Nav ---- */}
      <header
        className="sticky top-0 z-40 border-b border-white/[0.06] backdrop-blur"
        style={{ backgroundColor: `${ink}cc` }}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <DharmaMark className="h-7 w-7" style={{ color: indigoSoft }} />
            <span className="font-display text-[16px] font-semibold tracking-[-0.01em]">
              Dharma
            </span>
          </Link>
          <nav
            className="hidden items-center gap-8 text-sm md:flex"
            style={{ color: chalkMuted }}
          >
            <a href="#how" className="transition-colors hover:text-white">How it works</a>
            <a href="#pillars" className="transition-colors hover:text-white">Why Dharma</a>
            <Link href="/docs" className="transition-colors hover:text-white">Docs</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/auth/signin"
              className="rounded-lg px-3.5 py-2 text-sm font-medium transition-colors hover:text-white"
              style={{ color: chalkMuted }}
            >
              Sign in
            </Link>
            <Link
              href="/auth/signin"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{
                backgroundColor: indigo,
                boxShadow:
                  "0 1px 0 0 rgba(255,255,255,0.15) inset, 0 8px 24px -8px rgba(93,111,216,0.7)",
              }}
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* ---- Hero ---- */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8 lg:py-28">
        <div className="animate-fade-up">
          <div
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] tracking-wide"
            style={{ color: chalkMuted }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: neem }}
            />
            Self-hosted GRC · v1.0
          </div>

          {/* Fraunces carries the one line that has to be remembered. */}
          <h1 className="mt-6 text-balance font-display text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-[3.4rem]">
            Your compliance data
            <br />
            never leaves your walls.
          </h1>

          <p
            className="mt-6 max-w-xl text-[15px] leading-relaxed"
            style={{ color: chalkMuted }}
          >
            Dharma is a self-hosted platform for getting audit-ready on{" "}
            <span style={{ color: chalk }}>DPDP Act 2023</span>,{" "}
            <span style={{ color: chalk }}>ISO 27001</span>, and{" "}
            <span style={{ color: chalk }}>SOC 2</span> — using local AI and a
            tamper-evident audit ledger. No cloud vendor ever sees your firewall
            configs, logs, or evidence.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/auth/signin?callbackUrl=/dashboard"
              className="group inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{
                backgroundColor: indigo,
                boxShadow:
                  "0 1px 0 0 rgba(255,255,255,0.15) inset, 0 10px 30px -10px rgba(93,111,216,0.75)",
              }}
            >
              Get started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.02] px-5 py-3 text-sm font-medium transition-colors hover:border-white/25 hover:text-white"
              style={{ color: chalkMuted }}
            >
              See how it works
            </a>
          </div>

          <div
            className="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px]"
            style={{ color: chalkFaint }}
          >
            <span>local-ai inference</span>
            <span className="text-white/15">/</span>
            <span>sha-256 audit chain</span>
            <span className="text-white/15">/</span>
            <span>100% self-hosted</span>
          </div>
        </div>

        {/* Audit-ledger visual */}
        <div className="animate-fade-up [animation-delay:120ms]">
          <LedgerVisual />
        </div>
      </section>

      {/* ---- Pillars ---- */}
      <section id="pillars" className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:px-8 lg:py-20">
          <h2 className="max-w-2xl text-balance font-display text-2xl font-semibold tracking-[-0.02em] sm:text-[1.9rem]">
            The compliance platform for teams that can&apos;t send data out.
          </h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-3">
            {pillars.map(({ icon: Icon, title, body }) => (
              <div key={title} className="p-7" style={{ backgroundColor: panel }}>
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg border"
                  style={{
                    borderColor: "rgba(93,111,216,0.25)",
                    backgroundColor: "rgba(93,111,216,0.12)",
                    color: indigoSoft,
                  }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-[15px] font-semibold text-white">{title}</h3>
                <p
                  className="mt-2.5 text-[13.5px] leading-relaxed"
                  style={{ color: chalkMuted }}
                >
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section id="how" className="border-t border-white/[0.06]">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:px-8 lg:py-24">
          <div>
            <p
              className="font-mono text-[11px] uppercase tracking-[0.18em]"
              style={{ color: indigoSoft }}
            >
              Tamper-evident by design
            </p>
            <h2 className="mt-4 text-balance font-display text-2xl font-semibold tracking-[-0.02em] sm:text-[1.9rem]">
              Every action is chained. History can&apos;t be quietly rewritten.
            </h2>
            <p
              className="mt-5 max-w-lg text-[15px] leading-relaxed"
              style={{ color: chalkMuted }}
            >
              Standard audit trails live in a database a privileged admin can edit.
              Dharma hashes each event into the previous one and anchors the chain
              externally — so any tampering is mathematically obvious to an auditor,
              not a matter of trust.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Local AI maps evidence to controls — nothing uploaded to a vendor",
                "Time-boxed, read-only auditor portal with proof of integrity",
                "One-command Docker deploy on infrastructure you already run",
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 text-[14px]"
                  style={{ color: chalkMuted }}
                >
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: "rgba(92,184,127,0.16)", color: neem }}
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:pl-6">
            <LedgerVisual dense />
          </div>
        </div>
      </section>

      {/* ---- Frameworks + CTA ---- */}
      <section className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {frameworks.map((f) => (
              <span
                key={f}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 font-mono text-xs"
                style={{ color: chalkMuted }}
              >
                {f}
              </span>
            ))}
          </div>
          <h2 className="mx-auto mt-8 max-w-2xl text-balance font-display text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
            Own your compliance.
          </h2>
          <p
            className="mx-auto mt-4 max-w-lg text-[15px]"
            style={{ color: chalkMuted }}
          >
            Stand it up on your own infrastructure and be audit-ready without handing
            your most sensitive data to anyone.
          </p>
          <div className="mt-9 flex items-center justify-center">
            <Link
              href="/auth/signin?callbackUrl=/dashboard"
              className="group inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{
                backgroundColor: indigo,
                boxShadow:
                  "0 1px 0 0 rgba(255,255,255,0.15) inset, 0 12px 34px -12px rgba(93,111,216,0.8)",
              }}
            >
              Get started free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="border-t border-white/[0.06]">
        <div
          className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-[13px] sm:flex-row lg:px-8"
          style={{ color: chalkFaint }}
        >
          <div className="flex items-center gap-2.5">
            <DharmaMark className="h-[18px] w-[18px]" style={{ color: indigoSoft }} />
            <span className="font-medium" style={{ color: chalkMuted }}>
              Dharma
            </span>
          </div>
          <p>© {new Date().getFullYear()} Dharma · All data stays within your host boundary.</p>
        </div>
      </footer>
    </div>
  );
}

/* The tamper-evident ledger, visualized. Blocks chained by a connector with a
   "verify" pulse travelling down it. Pure CSS animation → works in a server
   component and respects prefers-reduced-motion (globals.css). */
function LedgerVisual({ dense = false }: { dense?: boolean }) {
  return (
    <div
      className="relative rounded-2xl border border-white/[0.08] bg-dharma-surface from-white/[0.04] to-transparent p-5"
      style={{ boxShadow: "0 30px 80px -40px rgba(93,111,216,0.5)" }}
    >
      <div className="mb-4 flex items-center justify-between px-1">
        <span className="font-mono text-[11px]" style={{ color: chalkMuted }}>
          audit_ledger
        </span>
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[10px]"
          style={{ color: neem }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: neem }} />
          verified
        </span>
      </div>

      <div className="relative">
        {/* connector rail + travelling pulse */}
        <div className="absolute bottom-3 left-[27px] top-3 w-px bg-white/10">
          <div
            className="animate-chain-scan absolute -left-[3px] h-8 w-[7px] rounded-full blur-[3px]"
            style={{ backgroundColor: "rgba(93,111,216,0.85)" }}
          />
        </div>

        <ul className={dense ? "space-y-2.5" : "space-y-3"}>
          {ledger.map((row, i) => (
            <li
              key={row.hash}
              className="relative flex items-center gap-4 rounded-xl border border-white/[0.07] p-3.5"
              style={{ backgroundColor: panel }}
            >
              <span
                className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
                style={{
                  borderColor: "rgba(93,111,216,0.3)",
                  backgroundColor: panel,
                  color: indigoSoft,
                }}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12px]" style={{ color: chalk }}>
                  {row.event}
                </div>
                <div className="font-mono text-[11px]" style={{ color: chalkFaint }}>
                  {i === 0 ? "genesis" : `prev ${ledger[i - 1].hash}`}
                </div>
              </div>
              <span
                className="shrink-0 rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[11px]"
                style={{ color: chalkMuted }}
              >
                {row.hash}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
