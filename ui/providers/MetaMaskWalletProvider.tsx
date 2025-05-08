"use client";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { BrowserProvider } from "ethers";
import { useToast } from "@/helpers/useToast";
import { openExternalLink } from "@/helpers/navigation";

interface MetaMaskWalletContextType {
  walletAddress: string | null;
  displayAddress: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

declare global {
  interface Window {
    ethereum?: any;
  }
}

const MetaMaskWalletContext = createContext<
  MetaMaskWalletContextType | undefined
>(undefined);

export const useMetaMaskWallet = (): MetaMaskWalletContextType => {
  const context = useContext(MetaMaskWalletContext);
  if (!context) {
    throw new Error(
      "useMetaMaskWallet must be used within a MetaMaskWalletProvider"
    );
  }
  return context;
};

export const MetaMaskWalletProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const formatDisplayAddress = (address: string | null) => {
    return address ? `${address.substring(0, 6)}...${address.slice(-4)}` : null;
  };

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      useToast({
        title: "Error",
        description: "MetaMask not installed",
        button: {
          label: "Install",
          onClick: () => openExternalLink("https://metamask.io/en-GB"),
        },
      });
      return;
    }

    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setIsConnected(true);
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  }, [useToast]);

  const disconnect = useCallback(() => {
    setWalletAddress(null);
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else if (accounts[0] !== walletAddress) {
        setWalletAddress(accounts[0]);
        setIsConnected(true);
      }
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    return () =>
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
  }, [walletAddress, disconnect]);

  useEffect(() => {
    const checkConnection = async () => {
      if (!window.ethereum) {
        useToast({
          title: "Error",
          description: "MetaMask not installed",
          button: {
            label: "Install",
            onClick: () => openExternalLink("https://metamask.io/en-GB"),
          },
        });
        return;
      }

      const provider = new BrowserProvider(window.ethereum);
      const accounts: string[] = await provider.send("eth_accounts", []);
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setIsConnected(true);
      } else {
        await connect();
      }
    };

    void checkConnection();
  }, [connect, useToast]);

  const value = {
    walletAddress,
    displayAddress: formatDisplayAddress(walletAddress),
    isConnected,
    connect,
    disconnect,
  };

  return (
    <MetaMaskWalletContext.Provider value={value}>
      {children}
    </MetaMaskWalletContext.Provider>
  );
};
