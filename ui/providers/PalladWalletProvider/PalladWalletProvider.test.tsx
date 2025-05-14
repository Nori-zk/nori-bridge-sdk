import "@testing-library/jest-dom";
import { describe, afterEach, beforeEach, expect, it, vi, Mock } from "vitest";
import { PalladWalletProvider, usePalladWallet } from "./PalladWalletProvider";
import { render, renderHook, screen, act } from "@testing-library/react";
import * as toastModule from "@/helpers/useToast";

// Mocks
const mockProvider = {
  request: vi.fn().mockResolvedValue({
    result: ["B62qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
  }),
};

const mockMina = { ...mockProvider };
Object.defineProperty(window, "mina", {
  value: mockMina,
  writable: true,
});

vi.mock("@/helpers/useToast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/helpers/navigation", () => ({
  openExternalLink: vi.fn(),
}));

const mockProviders = [
  {
    info: { slug: "pallad" },
    provider: mockProvider,
  },
];

vi.mock("@mina-js/connect", () => ({
  createStore: () => ({
    subscribe: (callback: () => void) => {
      callback();
      return () => {};
    },
    getProviders: () => mockProviders,
  }),
}));

// Test component to consume the context
const TestComponent = () => {
  const { walletAddress, displayAddress, isConnected } = usePalladWallet();
  return (
    <div>
      <div data-testid="address">{walletAddress || ""}</div>
      <div data-testid="display-address">{displayAddress || ""}</div>
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

  it("initializes context with default values", async () => {
    render(
      <PalladWalletProvider>
        <TestComponent />
      </PalladWalletProvider>
    );

    expect(screen.getByTestId("address").textContent).toBe("");
    expect(screen.getByTestId("display-address").textContent).toBe("");
    expect(screen.getByTestId("connected").textContent).toBe("false");

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockProvider.request).toHaveBeenCalledWith({
          method: "mina_requestAccounts",
        });
      });
    });

    expect(screen.getByTestId("address").textContent).toBe(
      "B62qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    );
    expect(screen.getByTestId("display-address").textContent).toBe(
      "B62qxx...xxxx"
    );
    expect(screen.getByTestId("connected").textContent).toBe("true");
  });

  it("shows toast when Pallad is not installed", async () => {
    // Mock useToast specifically for this test
    const mockToast = vi.fn();
    (toastModule.useToast as Mock).mockImplementation((defaultOptions) => {
      return (options?: any) => {
        const mergedOptions = {
          title: "Default Title",
          description: "Default Description",
          ...defaultOptions,
          ...options,
        };
        mockToast(mergedOptions);
      };
    });

    Object.defineProperty(window, "mina", { value: undefined, writable: true });

    render(
      <PalladWalletProvider>
        <TestComponent />
      </PalladWalletProvider>
    );

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: "Error",
          description: "Pallad is not installed",
          button: {
            label: "Install",
            onClick: expect.any(Function), // Use expect.any(Function) since openExternalLink is mocked
          },
        });
      });
    });
  });
});
