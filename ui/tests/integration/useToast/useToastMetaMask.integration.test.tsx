import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  MetaMaskWalletProvider,
  useMetaMaskWallet,
} from "@/providers/MetaMaskWalletProvider";
import * as toastModule from "@/helpers/useToast";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// Mock `useToast` to verify it was called
vi.mock("@/helpers/useToast", () => ({
  useToast: vi.fn(),
}));

function TestComponent() {
  const { connect } = useMetaMaskWallet();
  return <button onClick={connect}>Connect Wallet</button>;
}

describe("MetaMaskWalletProvider", () => {
  beforeEach(() => {
    // @ts-ignore
    delete window.ethereum;
  });

  it("shows toast when MetaMask is missing", async () => {
    const mockToast = vi.fn();
    (toastModule.useToast as Mock).mockImplementation(mockToast);

    render(
      <MetaMaskWalletProvider>
        <TestComponent />
      </MetaMaskWalletProvider>
    );

    fireEvent.click(screen.getByText("Connect Wallet"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: "MetaMask not installed",
        button: {
          label: "Install",
          onClick: expect.any(Function),
        },
      });
    });
  });
});
