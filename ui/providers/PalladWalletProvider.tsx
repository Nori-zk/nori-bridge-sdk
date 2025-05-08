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
  useState,
  useSyncExternalStore,
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

  const providers = useSyncExternalStore(
    store.subscribe,
    store.getProviders,
    () => initialSnapshot
  );

  const tryConnectWallet = async () => {
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
  };

  useEffect(() => {
    if (!window.mina) {
      const msg = "Pallad is not installed";
      console.error(msg);
      useToast({
        title: "Error",
        description: msg,
        button: {
          label: "Install",
          onClick: () => {
            openExternalLink("https://pallad.co");
          },
        },
      });
      return;
    }
    tryConnectWallet();
  }, [providers]);

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
