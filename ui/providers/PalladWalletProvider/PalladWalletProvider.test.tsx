import "@testing-library/jest-dom";
import { describe } from "node:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PalladWalletProvider, usePalladWallet } from "./PalladWalletProvider";
import { render, renderHook, screen } from "@testing-library/react";

// Mocks
const mockProvider = {
  request: vi.fn().mockResolvedValue({ result: ["B62qxxx...xxxx"] }),
};

const mockMina = { ...mockProvider };
Object.defineProperty(window, "mina", {
  value: mockMina,
  writable: true,
});

vi.mock("@/helpers/useToast", () => ({
  useToast: () => vi.fn(), // Correctly mock useToast
}));

// Mock the store
vi.mock("@mina-js/connect", () => ({
  createStore: () => ({
    subscribe: () => () => {},
    getProviders: () => [],
  }),
}));

vi.mock("@/helpers/navigation", () => ({
  openExternalLink: vi.fn(),
}));

// Test component to consume the context
const TestComponent = () => {
  const { walletAddress, walletDisplayAddress, isConnected } =
    usePalladWallet();
  return (
    <div>
      <div data-testid="address">{walletAddress || ""}</div>
      <div data-testid="display-address">{walletDisplayAddress || ""}</div>
      <div data-testid="connected">{isConnected.toString()}</div>
    </div>
  );
};

describe("PalladWalletProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_WALLET", "pallad");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws error when usePalladWallet is used outside provider", () => {
    const result = () => renderHook(() => usePalladWallet());
    expect(result).toThrowError(
      "usePalladWallet must be used within a PalladWalletProvider"
    );
  });

  it("initializes context with default values", () => {
    render(
      <PalladWalletProvider>
        <TestComponent />
      </PalladWalletProvider>
    );

    expect(screen.getByTestId("address").textContent).toBe("");
    expect(screen.getByTestId("display-address").textContent).toBe("");
    expect(screen.getByTestId("connected").textContent).toBe("false");
  });
});
