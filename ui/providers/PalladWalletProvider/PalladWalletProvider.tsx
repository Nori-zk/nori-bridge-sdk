"use client";
import { openExternalLink } from "@/helpers/navigation";
import { useToast } from "@/helpers/useToast";
import { createStore } from "@mina-js/connect";
import { MinaProviderClient } from "@mina-js/providers";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useCallback,
  useMemo,
} from "react";

interface PalladWalletContextType {
  walletDisplayAddress: string | null;
  walletAddress: string | null;
  isConnected: boolean;
  tryConnectWallet: () => void;
}

declare global {
  interface Window {
    mina: MinaProviderClient;
  }
}

const cleanedProvider = "pallad";
const initialSnapshot = [];
const store = createStore();

const PalladWalletContext = createContext<PalladWalletContextType | undefined>(
  undefined
);

export const usePalladWallet = (): PalladWalletContextType => {
  const context = useContext(PalladWalletContext);
  if (!context) {
    throw new Error(
      "usePalladWallet must be used within a PalladWalletProvider"
    );
  }
  return context;
};

export const PalladWalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const toast = useToast({
    title: "Error",
    description: "Pallad is not installed",
    button: {
      label: "Install",
      onClick: () => openExternalLink("https://pallad.co"),
    },
  });
  const hasWarnedRef = useRef(false);

  // Cache the providers to ensure stable reference
  const providers = useSyncExternalStore(
    store.subscribe,
    useCallback(() => store.getProviders(), []), // Cache getProviders result
    () => initialSnapshot
  );

  const tryConnectWallet = useCallback(async () => {
    if (isConnected) return;
    try {
      const provider = providers.find(
        (p) => p.info.slug === cleanedProvider
      )?.provider;

      if (!provider) return;

      const { result } = await provider.request({
        method: "mina_requestAccounts",
      });

      if (result.length > 0) {
        setWalletAddress(result[0]);
        setIsConnected(true);
      }
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    }
  }, [providers, isConnected]);

  useEffect(() => {
    if (providers.length === 0) return;

    const provider = providers.find(
      (p) => p.info.slug === cleanedProvider
    )?.provider;

    if (
      !hasWarnedRef.current &&
      (!window.mina ||
        (window.mina &&
          !provider &&
          process.env.NEXT_PUBLIC_WALLET === cleanedProvider))
    ) {
      hasWarnedRef.current = true;
      toast({
        title: "Error",
        description: "Pallad is not installed",
        button: {
          label: "Install",
          onClick: () => openExternalLink("https://pallad.co"),
        },
      });
      return;
    }

    tryConnectWallet();
  }, [providers, toast]);

  const walletDisplayAddress = useMemo(
    () =>
      walletAddress
        ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`
        : null,
    [walletAddress]
  );

  const value = useMemo(
    () => ({
      tryConnectWallet,
      walletAddress,
      walletDisplayAddress,
      isConnected,
    }),
    [tryConnectWallet, walletAddress, walletDisplayAddress, isConnected]
  );

  return (
    <PalladWalletContext.Provider value={value}>
      {children}
    </PalladWalletContext.Provider>
  );
};
