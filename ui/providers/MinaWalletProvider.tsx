"use client";
import { createStore } from "@mina-js/connect";
import { useSyncExternalStore } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import { createContext, ReactNode, useContext, useEffect } from "react";

interface MinaWalletContextType {
  tryConnectWallet: () => Promise<void>;
}

declare global {
  interface Window {
    mina: any;
  }
}

const store = createStore();

const MinaWalletContext = createContext<MinaWalletContextType | undefined>(
  undefined
);

export const useMinaWallet = (): MinaWalletContextType => {
  try {
    const context = useContext(MinaWalletContext);
    if (!context) {
      throw new Error("useMinaWallet must be used within a MinaWalletProvider");
    }
    return context;
  } catch (err) {
    throw err;
  }
};

export const MinaWalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const isClient = typeof window !== "undefined";
  const [currentProvider, setCurrentProvider] = isClient
    ? useLocalStorage("minajs:provider", "")
    : ["", () => {}];

  const providers = useSyncExternalStore(store.subscribe, store.getProviders);
  const provider = providers.find(
    (p) => p.info.slug === currentProvider
  )?.provider;

  const tryConnectWallet = async () => {
    try {
      console.log("This is try connect mina wallet");
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    const fetchRequestAccounts = async () => {
      if (!provider) return;
      const { result } = await provider.request({
        method: "mina_requestAccounts",
      });
      console.log("fetchRequestAccounts", result);
      // setResults(() => ({ mina_accounts: JSON.stringify(result) }));
    };

    fetchRequestAccounts();
  }, []);

  const value: MinaWalletContextType = {
    tryConnectWallet,
  };

  return (
    <MinaWalletContext.Provider value={value}>
      {children}
    </MinaWalletContext.Provider>
  );
};
