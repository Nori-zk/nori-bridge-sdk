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

interface EthereumWalletContextType {
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

const EthereumWalletContext = createContext<
  EthereumWalletContextType | undefined
>(undefined);

export const useEthereumWallet = (): EthereumWalletContextType => {
  const context = useContext(EthereumWalletContext);
  if (!context) {
    throw new Error(
      "useEthereumWallet must be used within a EthereumWalletProvider"
    );
  }
  return context;
};

export const EthereumWalletProvider = ({
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
    console.log("here");
    if (!window.ethereum) {
      console.error("MetaMask not installed");
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
  }, []);

  const disconnect = useCallback(() => {
    setWalletAddress(null);
    setIsConnected(false);
  }, []);

  // Handle account changes
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

  // Check initial connection
  useEffect(() => {
    const checkConnection = async () => {
      if (!window.ethereum) return;

      try {
        const provider = new BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_accounts", []);
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          setIsConnected(true);
        }
      } catch (error) {
        console.error("Error checking initial connection:", error);
      }
    };

    checkConnection();
  }, []);

  const value = {
    walletAddress,
    displayAddress: formatDisplayAddress(walletAddress),
    isConnected,
    connect,
    disconnect,
  };

  return (
    <EthereumWalletContext.Provider value={value}>
      {children}
    </EthereumWalletContext.Provider>
  );
};
