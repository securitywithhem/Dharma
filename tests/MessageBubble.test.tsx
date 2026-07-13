/** @jest-environment jsdom */
/**
 * tests/MessageBubble.test.tsx — Phase 7 Part 3.
 * Citation markers render as chips; malformed markers degrade to text.
 */
jest.mock("next/link", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children),
  };
});

import { render, screen } from "@testing-library/react";
import { MessageBubble } from "@/components/ai-advisor/MessageBubble";

describe("MessageBubble", () => {
  it("renders control citation markers as clickable chips (link)", () => {
    render(
      <MessageBubble
        role="assistant"
        content="MFA is enforced [[control:ctrl1]]."
        citations={[{ type: "control", id: "ctrl1" }]}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/dashboard/controls/ctrl1");
    expect(screen.getByText(/MFA is enforced/)).toBeInTheDocument();
  });

  it("renders a malformed marker as plain text, no crash, no link", () => {
    render(<MessageBubble role="assistant" content="See [[control:]] here" citations={[]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/\[\[control:\]\]/)).toBeInTheDocument();
  });

  it("renders user messages without an AI avatar", () => {
    const { container } = render(<MessageBubble role="user" content="hello" />);
    expect(container.textContent).toContain("hello");
    expect(screen.queryByText("AI")).toBeNull();
  });
});
