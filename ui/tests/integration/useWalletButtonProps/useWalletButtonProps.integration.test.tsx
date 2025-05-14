import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWalletButtonProps } from "@/helpers/useWalletButtonProps";
import * as MetaMask from "@/providers/MetaMaskWalletProvider";
import * as Pallad from "@/providers/PalladWalletProvider";

describe("useWalletButtonProps", () => {
  const content = "Connect Wallet";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct props for connected Ethereum wallet", () => {
    vi.spyOn(MetaMask, "useMetaMaskWallet").mockReturnValue({
      isConnected: true,
      displayAddress: "0x123",
      connect: vi.fn(),
      disconnect: vi.fn(),
      walletAddress: null,
    });

    vi.spyOn(Pallad, "usePalladWallet").mockReturnValue({
      isConnected: false,
      walletDisplayAddress: "",
      walletAddress: null,
      tryConnectWallet: function (): void {
        throw new Error("Function not implemented.");
      },
    });

    const { result } = renderHook(() =>
      useWalletButtonProps("Ethereum", content)
    );

    expect(result.current.bgClass).toBe("bg-connectedGreen");
    expect(result.current.textClass).toBe("text-white");
    expect(result.current.displayAddress).toBe("0x123");
    expect(typeof result.current.onClick).toBe("function");
  });

  it("returns correct props for disconnected Ethereum wallet", () => {
    const connectFn = vi.fn();

    vi.spyOn(MetaMask, "useMetaMaskWallet").mockReturnValue({
      isConnected: false,
      displayAddress: "",
      connect: connectFn,
      disconnect: vi.fn(),
      walletAddress: null,
    });

    vi.spyOn(Pallad, "usePalladWallet").mockReturnValue({
      isConnected: false,
      walletDisplayAddress: "",
      walletAddress: null,
      tryConnectWallet: function (): void {
        throw new Error("Function not implemented.");
      },
    });

    const { result } = renderHook(() =>
      useWalletButtonProps("Ethereum", content)
    );

    expect(result.current.bgClass).toBe("bg-white");
    expect(result.current.textClass).toBe("text-black");
    expect(result.current.displayAddress).toBe(content);

    // Simulate button click
    result.current.onClick();
    expect(connectFn).toHaveBeenCalled();
  });

  it("returns correct props for connected Mina wallet", () => {
    const connectFn = vi.fn();

    vi.spyOn(MetaMask, "useMetaMaskWallet").mockReturnValue({
      isConnected: false,
      displayAddress: "",
      connect: connectFn,
      disconnect: vi.fn(),
      walletAddress: null,
    });

    vi.spyOn(Pallad, "usePalladWallet").mockReturnValue({
      isConnected: true,
      walletDisplayAddress: "B62xyz",
      walletAddress: null,
      tryConnectWallet: function (): void {
        throw new Error("Function not implemented.");
      },
    });

    const { result } = renderHook(() => useWalletButtonProps("Mina", content));

    expect(result.current.bgClass).toBe("bg-connectedGreen");
    expect(result.current.textClass).toBe("text-white");
    expect(result.current.displayAddress).toBe("B62xyz");
    expect(typeof result.current.onClick).toBe("function");

    result.current.onClick();
  });

  it("returns correct props for disconnected Mina wallet", () => {
    const connectFn = vi.fn();

    vi.spyOn(MetaMask, "useMetaMaskWallet").mockReturnValue({
      isConnected: false,
      displayAddress: "",
      connect: connectFn,
      disconnect: vi.fn(),
      walletAddress: null,
    });

    vi.spyOn(Pallad, "usePalladWallet").mockReturnValue({
      isConnected: false,
      walletDisplayAddress: "",
      walletAddress: null,
      tryConnectWallet: function (): void {
        throw new Error("Function not implemented.");
      },
    });
    vi.spyOn(Pallad, "usePalladWallet").mockReturnValue({
      isConnected: false,
      walletDisplayAddress: "",
      walletAddress: null,
      tryConnectWallet: function (): void {
        throw new Error("Function not implemented.");
      },
    });

    const { result } = renderHook(() => useWalletButtonProps("Mina", content));

    expect(result.current.bgClass).toBe("bg-white");
    expect(result.current.textClass).toBe("text-black");
    expect(result.current.displayAddress).toBe(content);
  });
});
