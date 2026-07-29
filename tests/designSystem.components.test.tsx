/** @jest-environment jsdom */
/**
 * tests/designSystem.components.test.tsx
 *
 * Guards the two invariants the severity design system rests on:
 *   1. StatusBadge always renders the severity label as text. Light mode
 *      compresses MEDIUM/HIGH close together under protanopia, so the label is
 *      what keeps colour from being the sole channel (WCAG 1.4.1). If someone
 *      makes this chip icon-only, that becomes a real a11y defect — this test
 *      is the tripwire.
 *   2. DharmaRing renders its static arc, not the settle animation, when the
 *      user prefers reduced motion.
 */
import { render, screen, within } from "@testing-library/react";
import { StatusBadge, SEVERITIES, type Severity } from "@/components/ui/status-badge";
import { DharmaRing } from "@/components/DharmaRing";
import { ScoreGauge } from "@/components/readiness/ScoreGauge";

/** jsdom has no matchMedia; DharmaRing reads prefers-reduced-motion through it. */
function mockReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduce : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
}

beforeEach(() => mockReducedMotion(false));

describe("StatusBadge", () => {
  // Exactly the Prisma `Severity` enum — drift here means a row's severity
  // renders as the NONE fallback.
  it("covers every member of the Prisma Severity enum", () => {
    expect([...SEVERITIES]).toEqual(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  it.each(SEVERITIES)("renders %s as visible text, not colour alone", (severity) => {
    const { container } = render(<StatusBadge severity={severity} />);
    const expected = severity.charAt(0) + severity.slice(1).toLowerCase();
    expect(screen.getByText(expected)).toBeInTheDocument();

    // The dot is decorative reinforcement and must stay hidden from AT.
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    // Text content must survive with the dot removed.
    dot?.remove();
    expect(container.textContent).toContain(expected);
  });

  it("gives HIGH and CRITICAL visually distinct classes", () => {
    // The old SeverityBadge mapped both to the `destructive` variant, making
    // the two levels an auditor most needs to separate nearly identical.
    //
    // Warm Paper (2026-07-29) dropped the five-step --severity-* ramp for four
    // semantic roles, so HIGH and CRITICAL now legitimately SHARE a hue — this
    // no longer asserts distinct colour tokens, because there are none to
    // assert. What must still hold is that the two are not interchangeable:
    // CRITICAL carries the heavier weight and the inset rule.
    // See 0_DESIGN_SYSTEM.md § Accepted costs (2).
    const high = render(<StatusBadge severity="HIGH" />).container.firstElementChild;
    const critical = render(<StatusBadge severity="CRITICAL" />).container.firstElementChild;
    expect(high?.className).not.toEqual(critical?.className);
    expect(high?.className).toContain("font-medium");
    expect(critical?.className).toContain("font-semibold");
    expect(critical?.className).toContain("ring-dharma-danger");
  });

  it("keeps the severity label as a non-colour channel (WCAG 1.4.1)", () => {
    // Load-bearing since the ramp collapsed: with HIGH and CRITICAL sharing a
    // hue, the text label is the only channel that separates them for a user
    // who cannot rely on colour. It must never become icon-only.
    for (const [severity, label] of [
      ["HIGH", "High"],
      ["CRITICAL", "Critical"],
    ] as const) {
      const { container, unmount } = render(<StatusBadge severity={severity} />);
      container.querySelector('[aria-hidden="true"]')?.remove();
      expect(container.textContent).toContain(label);
      unmount();
    }
  });

  it("falls back to NONE for an unrecognised value rather than rendering unstyled", () => {
    render(<StatusBadge severity={"BOGUS" as Severity} />);
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("renders an aggregate count when given one", () => {
    render(<StatusBadge severity="CRITICAL" count={4} />);
    const badge = screen.getByText("Critical").closest("span");
    expect(within(badge as HTMLElement).getByText("4")).toBeInTheDocument();
  });
});

describe("DharmaRing", () => {
  const segments = [
    { severity: "CRITICAL" as const, value: 2 },
    { severity: "LOW" as const, value: 5 },
  ];

  it("animates when motion is allowed", () => {
    const { container } = render(<DharmaRing segments={segments} label="Findings" />);
    const ring = container.querySelector("[data-dharma-ring]");
    expect(ring?.getAttribute("data-animated")).toBe("true");
    const arcs = container.querySelectorAll("circle[stroke]");
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs[0].getAttribute("style")).toContain("dharma-ring-settle");
  });

  it("renders the static arc under prefers-reduced-motion", () => {
    mockReducedMotion(true);
    const { container } = render(<DharmaRing segments={segments} label="Findings" />);
    const ring = container.querySelector("[data-dharma-ring]");
    expect(ring?.getAttribute("data-animated")).toBe("false");

    // Static fallback = the arcs still render, with no animation attached.
    const arcs = container.querySelectorAll("circle[stroke]");
    expect(arcs.length).toBe(2);
    for (const arc of Array.from(arcs)) {
      expect(arc.getAttribute("style") ?? "").not.toContain("animation");
    }
  });

  it("orders arcs by severity regardless of input order", () => {
    const { container } = render(
      <DharmaRing
        segments={[
          { severity: "CRITICAL", value: 1 },
          { severity: "NONE", value: 1 },
          { severity: "MEDIUM", value: 1 },
        ]}
        label="Mix"
      />,
    );
    const strokes = Array.from(container.querySelectorAll("circle[stroke]")).map((c) =>
      c.getAttribute("stroke"),
    );
    expect(strokes).toEqual([
      "hsl(var(--severity-none))",
      "hsl(var(--severity-medium))",
      "hsl(var(--severity-critical))",
    ]);
  });

  it("drops zero-value segments so they cannot render a hairline artefact", () => {
    const { container } = render(
      <DharmaRing
        segments={[
          { severity: "LOW", value: 3 },
          { severity: "HIGH", value: 0 },
        ]}
        label="Mix"
      />,
    );
    expect(container.querySelectorAll("circle[stroke]").length).toBe(1);
  });

  it("is exposed to assistive tech as a labelled image", () => {
    render(<DharmaRing segments={segments} label="Open findings by severity" />);
    expect(screen.getByRole("img", { name: "Open findings by severity" })).toBeInTheDocument();
  });
});

describe("ScoreGauge", () => {
  it("leaves the remainder as unresolved track rather than filling the ring", () => {
    // total=100 is what makes a 62 read as 62% instead of a full circle.
    const { container } = render(<ScoreGauge score={62} />);
    const arc = container.querySelector("circle[stroke]");
    const [filled] = (arc?.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);
    const circumference = 2 * Math.PI * ((140 - 12) / 2);
    expect(filled / circumference).toBeCloseTo(0.62, 2);
  });

  it.each([
    [30, "Needs Attention"],
    [60, "In Progress"],
    [90, "On Track"],
  ])("labels a score of %i as %s", (score, label) => {
    render(<ScoreGauge score={score} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("clamps out-of-range scores", () => {
    render(<ScoreGauge score={140} />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});
