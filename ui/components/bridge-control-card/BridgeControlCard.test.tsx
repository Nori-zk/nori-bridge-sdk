/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import BridgeControlCard from "./BridgeControlCard";
import { useMetaMaskWallet } from "@/providers/MetaMaskWalletProvider";
import { usePalladWallet } from "@/providers/PalladWalletProvider";
import "@testing-library/jest-dom";

vi.mock("@/providers/MetaMaskWalletProvider", () => ({
  useMetaMaskWallet: vi.fn(),
}));
vi.mock("@/providers/PalladWalletProvider", () => ({
  usePalladWallet: vi.fn(),
}));
vi.mock("@/components/ui/WalletButton", () => ({
  default: ({ id, onClick, content = "WalletButton", types = "" }: any) => (
    <button data-testid={id} onClick={onClick}>
      {typeof content === "string" ? content : <span>Mocked Icon</span>} (
      {types})
    </button>
  ),
}));
vi.mock("@/components/ui/TextInput", () => ({
  default: ({ id, onChange }: any) => (
    <input data-testid={id} onChange={onChange} />
  ),
}));
vi.mock("@/components/ui/ProgressTracker", () => ({
  default: ({ steps = [] }: any) => (
    <div data-testid="progress-tracker">{steps.length} steps</div>
  ),
}));
vi.mock("@/static_data", () => ({
  progressSteps: ["Step 1", "Step 2"],
}));
vi.mock("*.svg", () => ({
  default: ({ className, ...props }) => (
    <svg data-testid="mocked-svg" className={className} {...props} />
  ),
}));

describe("BridgeControlCard", () => {
  const defaultProps = {
    title: "Bridge Control",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useMetaMaskWallet as any).mockReturnValue({
      isConnected: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      displayAddress: null,
    });
    (usePalladWallet as any).mockReturnValue({
      isConnected: false,
    });
  });

  it("renders the title correctly", () => {
    render(<BridgeControlCard {...defaultProps} />);
    expect(screen.getByText("Bridge Control")).toBeInTheDocument();
  });

  it("renders wallet buttons with correct initial content", () => {
    render(<BridgeControlCard {...defaultProps} />);
    expect(screen.getByTestId("eth-btn")).toHaveTextContent("Connect Wallet");
    expect(screen.getByTestId("mina-btn")).toHaveTextContent("Connect Wallet");
  });

  //TODO: Add the mina equivalent of the button tests below
  it("calls connect when Ethereum wallet button is clicked and not connected", async () => {
    const connectMock = vi.fn();
    (useMetaMaskWallet as any).mockReturnValue({
      isConnected: false,
      connect: connectMock,
      disconnect: vi.fn(),
      displayAddress: null,
    });
    render(<BridgeControlCard {...defaultProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("eth-btn"));
    });

    expect(connectMock).toHaveBeenCalled();
  });

  it("calls disconnect when Ethereum wallet button is clicked and connected", async () => {
    const disconnectMock = vi.fn();
    (useMetaMaskWallet as any).mockReturnValue({
      isConnected: true,
      connect: vi.fn(),
      disconnect: disconnectMock,
      displayAddress: "0x123...456",
    });
    render(<BridgeControlCard {...defaultProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("eth-btn"));
    });

    expect(disconnectMock).toHaveBeenCalled();
  });

  it("displays Ethereum wallet address when connected", () => {
    (useMetaMaskWallet as any).mockReturnValue({
      isConnected: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      displayAddress: "0x123...456 (Ethereum)",
    });
    render(<BridgeControlCard {...defaultProps} />);
    expect(screen.getByTestId("eth-btn")).toHaveTextContent(
      "0x123...456 (Ethereum)"
    );
  });

  it("renders text input", () => {
    render(<BridgeControlCard {...defaultProps} />);
    expect(screen.getByTestId("amount-input")).toBeInTheDocument();
  });

  it("does not show wallet linking message or progress tracker when wallets are not connected", () => {
    render(<BridgeControlCard {...defaultProps} />);
    expect(
      screen.queryByText("Wallet Linking Is Required For The First Time")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("progress-tracker")).not.toBeInTheDocument();
  });

  it("shows wallet linking message and progress tracker when both wallets are connected", () => {
    (useMetaMaskWallet as any).mockReturnValue({
      isConnected: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      displayAddress: "0x123...456",
    });
    (usePalladWallet as any).mockReturnValue({
      isConnected: true,
    });
    render(<BridgeControlCard {...defaultProps} />);
    expect(
      screen.getByText("Wallet Linking Is Required For The First Time")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bridge Contracts Are Compiling")
    ).toBeInTheDocument();
    expect(screen.getByTestId("progress-tracker")).toHaveTextContent("2 steps");
  });

  it("applies custom width and height styles when provided", () => {
    render(<BridgeControlCard {...defaultProps} width={500} height={300} />);
    const container =
      screen.getByText("Bridge Control").parentElement?.parentElement;
    expect(container).toHaveStyle({ width: "500px", height: "300px" });
  });
});
