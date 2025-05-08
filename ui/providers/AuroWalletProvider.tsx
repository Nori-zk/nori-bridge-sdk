"use client";
import { openExternalLink } from "@/helpers/navigation";
import { useToast } from "@/helpers/useToast";
import MinaProvider from "@aurowallet/mina-provider";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

interface AuroWalletContextType {
  walletDisplayAddress: string | null;
  walletAddress: string | null;
  isConnected: boolean;
  tryConnectWallet: () => void;
}

const AuroWalletContext = createContext<AuroWalletContextType | undefined>(
  undefined
);

export const useAuroWallet = (): AuroWalletContextType => {
  const context = useContext(AuroWalletContext);
  if (!context) {
    throw new Error("useAuroWallet must be used within an AuroWalletProvider");
  }
  return context;
};

export const AuroWalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const LOCAL_STORAGE_KEY = "MINA";

  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletDisplayAddress, setWalletDisplayAddress] = useState<
    string | null
  >(null);

  const tryConnectWallet = async () => {
    try {
      await (window.mina as MinaProvider)?.getAccounts();
      await connectWallet();
    } catch (err) {
      console.log(err);
    }
  };

  const connectWallet = async () => {
    try {
      const account = await (window.mina as MinaProvider)?.requestAccounts();
      updateWalletUI(account.toString());
    } catch (err) {
      console.log(err);
    }
  };

  const disconnectWallet = () => {
    try {
      updateWalletUI(null);
    } catch (err) {
      console.log(err);
    }
  };

  const updateWalletUI = (account: string | null) => {
    if (account?.[0]) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(account));
      setWalletDisplayAddress(account[0]);
      setIsConnected(true);
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      setWalletDisplayAddress(null);
      setIsConnected(false);
    }
    setWalletAddress(account);
  };

  const getWalletAddress = (): string | null => {
    try {
      if (typeof window !== "undefined") {
        const value = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (value !== null) {
          return JSON.parse(value);
        }
      }
      return null;
    } catch (err) {
      console.log(err);
      return null;
    }
  };

  useEffect(() => {
    console.log("address");
    const address = getWalletAddress();
    console.log("address", address);
    updateWalletUI(address);
  }, []);

  useEffect(() => {
    if (walletAddress) {
      console.log("Checking startUp value:");
    }
  }, [walletAddress]);

  useEffect(() => {
    const handleAccountsChanged = async (accounts: string[]) => {
      // console.log(accounts[0]);
      if (accounts.length !== 0) {
        await connectWallet();
      } else {
        disconnectWallet();
      }
    };

    (window.mina as MinaProvider)?.on("accountsChanged", handleAccountsChanged);

    // Clean up the event listener on unmount or when dependencies change
    return () => {
      (window.mina as MinaProvider)?.removeListener(
        "accountsChanged",
        handleAccountsChanged
      );
    };
  }, []);

  const value: AuroWalletContextType = {
    tryConnectWallet,
    walletAddress,
    walletDisplayAddress,
    isConnected,
  };

  return (
    <AuroWalletContext.Provider value={value}>
      {children}
    </AuroWalletContext.Provider>
  );
};
