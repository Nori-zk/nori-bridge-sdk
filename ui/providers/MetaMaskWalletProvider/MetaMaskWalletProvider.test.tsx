import "@testing-library/jest-dom";
import { describe, afterEach, beforeEach, expect, it, vi, Mock } from "vitest";
import {
  MetaMaskWalletProvider,
  useMetaMaskWallet,
} from "./MetaMaskWalletProvider.tsx";
import { render, screen, act, renderHook } from "@testing-library/react";
import * as toastModule from "@/helpers/useToast.tsx";
import { BrowserProvider } from "ethers";

// Mocks
const mockEthereum = {
  request: vi
    .fn()
    .mockResolvedValue(["0x1234567890123456789012345678901234567890"]),
  on: vi.fn(),
  removeListener: vi.fn(),
  isMetaMask: true,
};
Object.defineProperty(window, "ethereum", {
  value: mockEthereum,
  writable: true,
});

vi.mock("@/helpers/useToast", () => ({
  useToast: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("@/helpers/navigation", () => ({
  openExternalLink: vi.fn(),
}));

vi.mock("@/helpers/walletHelper", () => ({
  formatDisplayAddress: vi.fn((address: string | null) =>
    address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""
  ),
}));

vi.mock("ethers", () => ({
  BrowserProvider: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockImplementation(async (method: string, params: any[]) => {
      // Delegate to mockEthereum.request to align with test expectations
      return mockEthereum.request({ method, params });
    }),
  })),
}));

const TestComponent = () => {
  const { walletAddress, displayAddress, isConnected } = useMetaMaskWallet();
  return (
    <div>
      <div data-testid="address">{walletAddress || ""}</div>
      <div data-testid="display-address">{displayAddress || ""}</div>
      <div data-testid="connected">{isConnected.toString()}</div>
    </div>
  );
};

describe("MetaMaskWalletProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws error when useMetaMaskWallet is used outside provider", () => {
    const consoleError = console.error;
    console.error = vi.fn();

    expect(() => render(<TestComponent />)).toThrowError(
      "useMetaMaskWallet must be used within a MetaMaskWalletProvider"
    );

    console.error = consoleError;
  });

  it("initializes context with default values", async () => {
    render(
      <MetaMaskWalletProvider>
        <TestComponent />
      </MetaMaskWalletProvider>
    );

    expect(screen.getByTestId("address").textContent).toBe("");
    expect(screen.getByTestId("display-address").textContent).toBe("");
    expect(screen.getByTestId("connected").textContent).toBe("false");

    // Wait for useEffect to complete
    await act(async () => {
      await vi.waitFor(
        () => {
          expect(mockEthereum.request).toHaveBeenCalledWith({
            method: "eth_accounts",
            params: [],
          });
        },
        { timeout: 1000 }
      );
    });

    expect(screen.getByTestId("address").textContent).toBe(
      "0x1234567890123456789012345678901234567890"
    );
    expect(screen.getByTestId("display-address").textContent).toBe(
      "0x1234...7890"
    );
    expect(screen.getByTestId("connected").textContent).toBe("true");
  });

  it("shows toast when MetaMask is not installed", async () => {
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

    Object.defineProperty(window, "ethereum", {
      value: undefined,
      writable: true,
    });

    render(
      <MetaMaskWalletProvider>
        <TestComponent />
      </MetaMaskWalletProvider>
    );

    await act(async () => {
      await vi.waitFor(
        () => {
          expect(mockToast).toHaveBeenCalledWith({
            title: "Error",
            description: "MetaMask is not installed",
            button: {
              label: "Install",
              onClick: expect.any(Function),
            },
          });
        },
        { timeout: 1000 }
      );
    });

    expect(screen.getByTestId("address").textContent).toBe("");
    expect(screen.getByTestId("display-address").textContent).toBe("");
    expect(screen.getByTestId("connected").textContent).toBe("false");
  });

  it("handles accounts changed event", async () => {
    render(
      <MetaMaskWalletProvider>
        <TestComponent />
      </MetaMaskWalletProvider>
    );

    await act(async () => {
      await vi.waitFor(
        () => {
          expect(mockEthereum.request).toHaveBeenCalledWith({
            method: "eth_accounts",
            params: [],
          });
        },
        { timeout: 1000 }
      );
    });

    // Simulate accounts changed event
    await act(async () => {
      mockEthereum.on.mock.calls[0][1]([
        "0x0987654321098765432109876543210987654321",
      ]);
    });
    expect(screen.getByTestId("address").textContent).toBe(
      "0x0987654321098765432109876543210987654321"
    );
    expect(screen.getByTestId("display-address").textContent).toBe(
      "0x0987...4321"
    );
    expect(screen.getByTestId("connected").textContent).toBe("true");
    // Simulate account disconnection
    await act(async () => {
      mockEthereum.on.mock.calls[0][1]([]);
    });
    expect(screen.getByTestId("address").textContent).toBe("");
    expect(screen.getByTestId("display-address").textContent).toBe("");
    expect(screen.getByTestId("connected").textContent).toBe("false");
  });

  it("handles connect function", async () => {
    render(
      <MetaMaskWalletProvider>
        <TestComponent />
      </MetaMaskWalletProvider>
    );
    const { result } = renderHook(() => useMetaMaskWallet(), {
      wrapper: MetaMaskWalletProvider,
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(BrowserProvider).toHaveBeenCalledWith(window.ethereum);
    expect(mockEthereum.request).toHaveBeenCalledWith({
      method: "eth_requestAccounts",
      params: [],
    });
    expect(result.current.walletAddress).toBe(
      "0x1234567890123456789012345678901234567890"
    );
    expect(result.current.displayAddress).toBe("0x1234...7890");
    expect(result.current.isConnected).toBe(true);
  });

  it("handles disconnect function", async () => {
    render(
      <MetaMaskWalletProvider>
        <TestComponent />
      </MetaMaskWalletProvider>
    );
    const { result } = renderHook(() => useMetaMaskWallet(), {
      wrapper: MetaMaskWalletProvider,
    });

    // Wait for initial connection from useEffect
    await act(async () => {
      await vi.waitFor(
        () => {
          expect(mockEthereum.request).toHaveBeenCalledWith({
            method: "eth_accounts",
            params: [],
          });
        },
        { timeout: 1000 }
      );
    });

    // Verify connected state before disconnect
    expect(result.current.walletAddress).toBe(
      "0x1234567890123456789012345678901234567890"
    );
    expect(result.current.displayAddress).toBe("0x1234...7890");
    expect(result.current.isConnected).toBe(true);

    await act(async () => {
      result.current.disconnect();
    });

    expect(result.current.walletAddress).toBe(null);
    expect(result.current.displayAddress).toBe("");
    expect(result.current.isConnected).toBe(false);
  });
});
