/** @jest-environment jsdom */
/**
 * tests/CitationChip.test.tsx — Phase 7 Part 3.
 * Verifies navigation targets and the defense-in-depth allow-list.
 */
jest.mock("next/link", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children),
  };
});

import { render, screen } from "@testing-library/react";
import { CitationChip } from "@/components/ai-advisor/CitationChip";

describe("CitationChip", () => {
  it("renders a control citation as a link to the control detail page", () => {
    render(<CitationChip type="control" id="ctrl123" allowedIds={new Set(["ctrl123"])} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/dashboard/controls/ctrl123");
  });

  it("renders an evidence citation as a link to the evidence detail page", () => {
    render(<CitationChip type="evidence" id="ev9" allowedIds={new Set(["ev9"])} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/dashboard/evidence/ev9");
  });

  it("does NOT render a link when the id is not in the allow-list (defense in depth)", () => {
    render(<CitationChip type="control" id="not_allowed" allowedIds={new Set(["other"])} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Control not_allo/)).toBeInTheDocument();
  });

  it("renders chunk citations as inert (no navigation target)", () => {
    render(<CitationChip type="chunk" id="k1" allowedIds={new Set(["k1"])} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not render a link for a malformed id even if allow-listed", () => {
    render(<CitationChip type="control" id="bad id!" allowedIds={new Set(["bad id!"])} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
