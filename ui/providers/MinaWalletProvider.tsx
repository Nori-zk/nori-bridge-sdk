"use client";
import { openExternalLink } from "@/helpers/navigation";
import { toast } from "@/helpers/useToast";
import { createStore } from "@mina-js/connect";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

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

const MinaWalletContext = createContext<MinaWalletContextType | undefined>(
  undefined
);

export const useMinaWallet = (): MinaWalletContextType => {
  const context = useContext(MinaWalletContext);
  if (!context) {
    throw new Error("useMinaWallet must be used within a MinaWalletProvider");
  }
  return context;
};

export const MinaWalletProvider: React.FC<{ children: ReactNode }> = ({
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

      console.log("providers: " + providers);
      console.log("provider: " + provider);

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
      toast({
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

  const value: MinaWalletContextType = {
    tryConnectWallet,
    walletAddress,
    walletDisplayAddress,
    isConnected,
  };

  return (
    <MinaWalletContext.Provider value={value}>
      {children}
    </MinaWalletContext.Provider>
  );
};
