"use client";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { ethers } from "ethers";
import { useToast } from "@/helpers/useToast";
import { openExternalLink } from "@/helpers/navigation";
import { formatDisplayAddress } from "@/helpers/walletHelper";
import contractABI from "@/contractABI.json";

interface MetaMaskWalletContextType {
  walletAddress: string | null;
  displayAddress: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: () => Promise<void>;
  bridgeOperator: () => Promise<void>;
  lockTokens: () => Promise<void>;
  getLockedTokens: () => Promise<string | undefined>;
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
  const [signer, setSigner] = useState<
    ethers.providers.JsonRpcSigner | undefined
  >();
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [lockedAmount, setLockedAmount] = useState<string | null>(null);

  const rawToast = useToast({
    title: "Error",
    description: "MetaMask is not installed",
    button: {
      label: "Install",
      onClick: () => openExternalLink("https://pallad.co"),
    },
  });
  const toast = useRef(rawToast);

  const initializeContract = useCallback(async (signer: ethers.Signer) => {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
    return new ethers.Contract(contractAddress, contractABI, signer);
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      toast.current();
      return;
    }

    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      if (accounts.length > 0) {
        const signer = provider.getSigner();
        console.log("Signer:", signer);
        const address = accounts[0];
        setWalletAddress(address);
        setIsConnected(true);
        setSigner(signer);

        const newContract = await initializeContract(signer);
        setContract(newContract);
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  }, [initializeContract, toast]);

  const disconnect = useCallback(() => {
    setWalletAddress(null);
    setIsConnected(false);
    setSigner(null);
    setContract(null);
  }, []);

  const signMessage = useCallback(async () => {
    console.log("signing", signer);
    if (!signer) return;
    try {
      const message = "signing";
      const signature = await signer.signMessage(message);
      const digest = ethers.utils.hashMessage(message);
      const publicKey = ethers.utils.recoverPublicKey(digest, signature);
      console.log("Public Key:", publicKey);
    } catch (error) {
      console.error("Error signing message:", error);
    }
  }, [signer]);

  const bridgeOperator = useCallback(async () => {
    if (!contract) return;
    try {
      const operator = await contract.bridgeOperator();
      alert(`Bridge Operator: ${operator}`);
    } catch (error) {
      console.error("Error calling bridgeOperator:", error);
      alert("Failed to fetch bridge operator. Check console for details.");
    }
  }, [contract]);

  const lockTokens = useCallback(async () => {
    if (!contract) return alert("Connect wallet first!");
    try {
      const tx = await contract.lockTokens({
        value: ethers.utils.parseEther("0.0000000000000001"),
      });
      await tx.wait();
      alert("Tokens locked successfully!");
    } catch (error) {
      console.error("Error calling lockTokens:", error);
      alert("Transaction failed. Check console for details.");
    }
  }, [contract]);

  const getLockedTokens = useCallback(async () => {
    if (!contract || !walletAddress) return;
    try {
      const amount = await contract.lockedTokens(walletAddress);
      return ethers.utils.formatEther(amount);
    } catch (error) {
      toast.current();
      console.error("Error fetching locked tokens:", error);
      alert("Transaction failed. Check console for details.");
      return;
    }
  }, [contract, walletAddress]);

  useEffect(() => {
    const checkConnection = async () => {
      if (!window.ethereum) {
        return toast.current();
      }

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await provider.send("eth_accounts", []);
      if (accounts.length > 0) {
        const signer = provider.getSigner();
        const address = accounts[0];
        setWalletAddress(address);
        setIsConnected(true);
        setSigner(signer);
        const newContract = await initializeContract(signer);
        setContract(newContract);
      }
    };

    void checkConnection();
  }, [initializeContract, toast]);

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else {
        if (accounts[0] !== walletAddress) {
          setWalletAddress(accounts[0]);
        }
      }
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
    };
  }, [walletAddress, disconnect]);

  const value = useMemo(
    () => ({
      walletAddress,
      displayAddress: formatDisplayAddress(walletAddress),
      isConnected,
      connect,
      disconnect,
      signMessage,
      bridgeOperator,
      lockTokens,
      getLockedTokens,
    }),
    [
      walletAddress,
      isConnected,
      connect,
      disconnect,
      signMessage,
      bridgeOperator,
      lockTokens,
      getLockedTokens,
    ]
  );

  return (
    <MetaMaskWalletContext.Provider value={value}>
      {children}
    </MetaMaskWalletContext.Provider>
  );
};
