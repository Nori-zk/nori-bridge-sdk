/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ScrollingBridge from "./ScrollingBridge";
import "@testing-library/jest-dom";

global.fetch = vi.fn();

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

describe("ScrollingBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      text: () =>
        Promise.resolve('<svg fill="black" stroke="black">Test SVG</svg>'),
    });
  });

  it("renders the component container", () => {
    render(<ScrollingBridge />);
    const container = screen.getByTestId("scrolling-bridge-container");
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass(
      "relative w-full h-full overflow-hidden flex justify-center"
    );
  });

  it("applies correct maskImage style to container", () => {
    render(<ScrollingBridge />);
    const container = screen.getByTestId("scrolling-bridge-container");
    expect(container).toHaveStyle({
      maskImage:
        "linear-gradient(to left, transparent 5%, white 30%, white 100%)",
    });
  });
});
