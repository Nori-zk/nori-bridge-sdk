import { PalladWalletProvider } from "@/providers/PalladWalletProvider/PalladWalletProvider.";
import "@testing-library/jest-dom";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import * as toastModule from "@/helpers/useToast.tsx";

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
  useToast: vi.fn(() => vi.fn()),
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

describe("PalladWalletProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows toast when Pallad is not installed", async () => {
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
        <></>
      </PalladWalletProvider>
    );

    await act(async () => {
      await vi.waitFor(
        () => {
          expect(mockToast).toHaveBeenCalledWith({
            title: "Error",
            description: "Pallad is not installed",
            button: {
              label: "Install",
              onClick: expect.any(Function),
            },
          });
        },
        { timeout: 1000 }
      );
    });

    // await waitFor(() => {
    //   expect(mockToast).toHaveBeenCalledWith({
    //     title: "Error",
    //     description: "Pallad is not installed",
    //     button: {
    //       label: "Install",
    //       onClick: expect.any(Function),
    //     },
    //   });
    // });
  });
});
