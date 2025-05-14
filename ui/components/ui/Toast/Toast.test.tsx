import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Toast, { ToastProps } from "./Toast";
import { toast as sonnerToast } from "sonner";

describe("Toast", () => {
  const defaultProps: ToastProps = {
    id: "toast-1",
    title: "Success",
    description: "Operation completed successfully.",
  };

  it("renders the component container", () => {
    render(<Toast {...defaultProps} />);
    expect(screen.getByTestId("toast-1")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(
      screen.getByText("Operation completed successfully.")
    ).toBeInTheDocument();
  });

  it("does not render button when button prop is undefined", () => {
    render(<Toast {...defaultProps} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not render button when button prop is undefined", () => {
    render(
      <Toast {...defaultProps} button={{ label: "hi", onClick: () => {} }} />
    );
    expect(screen.queryByRole("button")).toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("calls button onClick and dismisses toast when button is clicked", async () => {
    const mockOnClick = vi.fn();
    const dismiss = vi.spyOn(sonnerToast, "dismiss");

    const buttonProps = {
      ...defaultProps,
      button: {
        label: "Undo",
        onClick: mockOnClick,
      },
    };
    render(<Toast {...buttonProps} />);
    const button = screen.getByRole("button", { name: /Undo/i });
    fireEvent.click(button);

    expect(mockOnClick).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("renders with empty title and description", () => {
    const emptyProps = {
      ...defaultProps,
      title: "",
      description: "",
    };
    render(<Toast {...emptyProps} />);
    const title = screen.getByTestId(`toast-title-${defaultProps.id}`);
    const description = screen.getByTestId(
      `toast-description-${defaultProps.id}`
    );

    expect(title).toBeInTheDocument();
    expect(title).toBeEmptyDOMElement();

    expect(description).toBeInTheDocument();
    expect(description).toBeEmptyDOMElement();
  });
});
