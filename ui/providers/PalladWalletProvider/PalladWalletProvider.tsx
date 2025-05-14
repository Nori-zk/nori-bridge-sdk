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

  const toast = useToast();

  const hasWarnedRef = useRef(false);
  const providers = useSyncExternalStore(
    store.subscribe,
    store.getProviders,
    () => initialSnapshot
  );

  const tryConnectWallet = useCallback(async () => {
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
  }, [providers]);

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

    if (!isConnected) {
      tryConnectWallet();
    }
  }, [providers, toast, tryConnectWallet, isConnected]);

  const walletDisplayAddress = walletAddress
    ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const value: PalladWalletContextType = {
    tryConnectWallet,
    walletAddress,
    walletDisplayAddress,
    isConnected,
  };

  return (
    <PalladWalletContext.Provider value={value}>
      {children}
    </PalladWalletContext.Provider>
  );
};
