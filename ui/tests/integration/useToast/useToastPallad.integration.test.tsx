import { PalladWalletProvider } from "@/providers/PalladWalletProvider";
import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import * as toastModule from "@/helpers/useToast";

vi.mock("@/helpers/useToast", () => ({
  useToast: vi.fn(() => vi.fn()),
}));

vi.mock("@/mina-js/connect", async () => {
  const actual = await vi.importActual<typeof import("@mina-js/connect")>(
    "@/mina-js/connect"
  );
  return {
    ...actual,
    createStore: () => ({
      subscribe: (cb: () => void) => cb(),
      getProviders: () => [
        {
          info: { slug: "pallad" },
          provider: {
            request: vi.fn().mockResolvedValue({ result: [] }),
          },
        },
      ],
    }),
  };
});

describe("PalladWalletProvider", () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    delete window.mina;
    mockToast.mockClear();
    (toastModule.useToast as Mock).mockImplementation(() => mockToast);
  });

  it("shows toast when Pallad is not installed", async () => {
    render(
      <PalladWalletProvider>
        <></>
      </PalladWalletProvider>
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: "Pallad is not installed",
        button: {
          label: "Install",
          onClick: expect.any(Function),
        },
      });
    });
  });
});
