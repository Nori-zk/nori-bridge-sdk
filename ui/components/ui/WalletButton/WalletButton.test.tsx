import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import "@testing-library/jest-dom";
import { WalletButtonTypes } from "@/types/types.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import WalletButton, { WalletButtonProps } from "./WalletButton.tsx";
import { useWalletButtonProps } from "@/helpers/useWalletButtonProps.tsx";

// Mock the useWalletButtonProps hook
vi.mock("@/helpers/useWalletButtonProps");

const mockUseWalletButtonProps = useWalletButtonProps as Mock;

describe("WalletButton", () => {
  const defaultProps: WalletButtonProps = {
    id: "wallet-button",
    types: "Mina",
    content: "Connect Wallet",
    width: 200,
  };

  const mockHookReturn = {
    bgClass: "bg-blue-500",
    textClass: "text-white",
    displayAddress: "0x123...456",
    logo: <span data-testid="logo">Logo</span>,
    onClick: vi.fn(),
  };

  beforeEach(() => {
    mockUseWalletButtonProps.mockReturnValue(mockHookReturn);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders button with correct id, content, and width", () => {
    render(<WalletButton {...defaultProps} />);
    const button = screen.getByTestId("wallet-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("id", "wallet-button");
    expect(button).toHaveStyle({ width: "200px" });
    expect(button).toHaveTextContent("0x123...456");
    expect(screen.getByTestId("logo")).toBeInTheDocument();
  });

  it("renders button with correct id, content, and width", () => {
    render(<WalletButton {...defaultProps} />);
    const button = screen.getByTestId("wallet-button");
    expect(button).toHaveClass("bg-blue-500");
    expect(button).toHaveClass("text-white");
  });

  it("calls onClick from useWalletButtonProps when clicked", () => {
    render(<WalletButton {...defaultProps} />);
    const button = screen.getByTestId("wallet-button");
    button.click();
    expect(mockHookReturn.onClick).toHaveBeenCalledTimes(1);
  });

  it("calls custom onClick prop when clicked", () => {
    const customOnClick = vi.fn();
    render(<WalletButton {...defaultProps} onClick={customOnClick} />);
    const button = screen.getByTestId("wallet-button");
    fireEvent.click(button);
    expect(mockHookReturn.onClick).not.toHaveBeenCalled();
    expect(customOnClick).toHaveBeenCalledTimes(1);
  });

  it("passes types and content to useWalletButtonProps", () => {
    render(<WalletButton {...defaultProps} />);

    expect(mockUseWalletButtonProps).toHaveBeenCalledWith(
      defaultProps.types,
      defaultProps.content
    );
  });

  it.each(["Ethereum", "Mina"] as WalletButtonTypes[])(
    "renders correctly for type %s",
    (type) => {
      const propsWithType = { ...defaultProps, types: type };
      render(<WalletButton {...propsWithType} />);

      const button = screen.getByTestId("wallet-button");
      expect(button).toBeInTheDocument();
      expect(mockUseWalletButtonProps).toHaveBeenCalledWith(
        type,
        defaultProps.content
      );
    }
  );
});
