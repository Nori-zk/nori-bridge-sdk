"use client";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { BrowserProvider } from "ethers";

interface EthereumWalletContextType {
  walletDisplayAddress: string | null;
  walletAddress: string | null;
  isConnected: boolean;
  tryConnectWallet: () => void;
}

declare global {
  interface Window {
    ethereum: any;
  }
}

const EthereumWalletContext = createContext<
  EthereumWalletContextType | undefined
>(undefined);

export const useEthereumWallet = (): EthereumWalletContextType => {
  try {
    const context = useContext(EthereumWalletContext);
    if (!context) {
      throw new Error(
        "useEthereumWallet must be used within a EthereumWalletProvider"
      );
    }
    return context;
  } catch (err) {
    throw err;
  }
};

export const EthereumWalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const tryConnectWallet = async () => {
    try {
      if (!window.ethereum) {
        throw new Error("MetaMask is not installed");
      }
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setIsConnected(true);
      }
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    }
  };

  useEffect(() => {
    tryConnectWallet();
  }, []);

  // useEffect(() => {
  //   console.log("walletAddress", walletAddress);
  //   console.log("isConnected", isConnected);
  // }, [isConnected, walletAddress]);

  const walletDisplayAddress = walletAddress
    ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const value: EthereumWalletContextType = {
    tryConnectWallet,
    walletAddress,
    walletDisplayAddress,
    isConnected,
  };

  return (
    <EthereumWalletContext.Provider value={value}>
      {children}
    </EthereumWalletContext.Provider>
  );
};
