"use client";
import { createStore } from "@mina-js/connect";
import { useState, useSyncExternalStore } from "react";
import { createContext, ReactNode, useContext, useEffect } from "react";

interface MinaWalletContextType {
  walletDisplayAddress: string | null;
  walletAddress: string | null;
  isConnected: boolean;
  tryConnectWallet: () => void;
}

declare global {
  interface Window {
    mina: any;
  }
}

const cleanedProvider = "pallad";
const initialSnapshot = [];
const store = createStore();

const MinaWalletContext = createContext<MinaWalletContextType | undefined>(undefined);

export const useMinaWallet = (): MinaWalletContextType => {
  const context = useContext(MinaWalletContext);
  if (!context) {
    throw new Error("useMinaWallet must be used within a MinaWalletProvider");
  }
  return context;
};

export const MinaWalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const providers = useSyncExternalStore(store.subscribe, store.getProviders, () => initialSnapshot);

  const tryConnectWallet = async () => {
    try {
      const provider = providers.find((p) => p.info.slug === cleanedProvider)?.provider;
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
      console.error("Pallad is not installed");
      return;
    }
    tryConnectWallet();
  }, []);

  const walletDisplayAddress = walletAddress ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}` : null;

  const value: MinaWalletContextType = {
    tryConnectWallet,
    walletAddress,
    walletDisplayAddress,
    isConnected,
  };

  return <MinaWalletContext.Provider value={value}>{children}</MinaWalletContext.Provider>;
};
