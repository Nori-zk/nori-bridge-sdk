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
import { BrowserProvider, Contract, ethers, Signer } from "ethers";
import { useToast } from "@/helpers/useToast.tsx";
import { openExternalLink } from "@/helpers/navigation.tsx";
import { formatDisplayAddress } from "@/helpers/walletHelper.tsx";
import contractABI from "@/contractABI.json";

interface SignMessageResult {
  signature: string;
  walletAddress: string;
  hashedMessage: string;
}

interface MetaMaskWalletContextType {
  walletAddress: string | null;
  displayAddress: string | null;
  isConnected: boolean;
  lockedAmount: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: () => Promise<void>;
  signMessageForEcdsa: (message: string) => Promise<SignMessageResult>;
  bridgeOperator: () => Promise<void>;
  lockTokens: () => Promise<void>;
  getLockedTokens: () => Promise<void>;
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
  const [signer, setSigner] = useState<Signer | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [lockedAmount, setLockedAmount] = useState<string | null>(null);

  const rawToast = useToast({
    type: "error",
    title: "Error",
    description: "MetaMask is not installed",
    button: {
      label: "Install",
      onClick: () => openExternalLink("https://metamask.io"),
    },
  });
  const toast = useRef(rawToast);

  const initializeContract = useCallback(async (signer: Signer) => {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
    return new Contract(contractAddress, contractABI, signer);
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      toast.current();
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      if (accounts.length > 0) {
        const signer = await provider.getSigner();
        const address = accounts[0];
        setWalletAddress(address);
        setIsConnected(true);
        setSigner(signer);

        const newContract = await initializeContract(signer);
        setContract(newContract);
        toast.current({
          type: "notification",
          title: "Success",
          description: "Wallet connected successfully!",
        });
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      toast.current({
        type: "error",
        title: "Error",
        description: "Failed to connect wallet.",
      });
    }
  }, [initializeContract, toast]);

  const disconnect = useCallback(() => {
    setWalletAddress(null);
    setIsConnected(false);
    setSigner(null);
    setContract(null);
    toast.current({
      type: "notification",
      title: "Disconnected",
      description: "Wallet disconnected successfully.",
    });
  }, [toast]);

  const signMessage = useCallback(async () => {
    if (!signer) {
      toast.current({
        type: "error",
        title: "Error",
        description: "Please connect wallet first.",
      });
      return;
    }
    try {
      const message = "signing";
      const signature = await signer.signMessage(message);
      const digest = ethers.hashMessage(message);
      const publicKey = ethers.recoverAddress(digest, signature);
      console.log("Public Key:", publicKey);
      toast.current({
        type: "notification",
        title: "Success",
        description: "Message signed successfully!",
      });
    } catch (error) {
      console.error("Error signing message:", error);
      toast.current({
        type: "error",
        title: "Error",
        description: "Error signing message.",
      });
    }
  }, [signer, toast]);

  const signMessageForEcdsa = useCallback(
    async (message: string): Promise<SignMessageResult> => {
      if (!contract) {
        toast.current({
          type: "error",
          title: "Error",
          description: "Please connect wallet first.",
        });
        throw new Error("Wallet not connected");
      }
      try {
        const parseHex = (hex: string) => ethers.getBytes(hex);
        const hashMessage = (msg: string) => parseHex(ethers.id(msg));
        const hashedMessage = ethers.hexlify(hashMessage(message));
        const signature = await window.ethereum.request({
          method: "personal_sign",
          params: [hashedMessage, walletAddress!],
        });
        return { signature, walletAddress: walletAddress!, hashedMessage };
      } catch (error) {
        console.error("Error calling signMessageForEcdsa:", error);
        toast.current({
          type: "error",
          title: "Error",
          description: "Error calling sign message for ECDSA.",
        });
        throw error;
      }
    },
    [signer, walletAddress, toast]
  );

  const bridgeOperator = useCallback(async () => {
    if (!contract) {
      toast.current({
        type: "error",
        title: "Error",
        description: "Please connect wallet first.",
      });
      return;
    }
    try {
      const operator = await contract.bridgeOperator();
      toast.current({
        type: "notification",
        title: "Bridge Operator",
        description: `Bridge Operator: ${operator}`,
      });
    } catch (error) {
      console.error("Error calling bridgeOperator:", error);
      toast.current({
        type: "error",
        title: "Error",
        description: "Error calling bridge operator.",
      });
    }
  }, [contract, toast]);

  const lockTokens = useCallback(async () => {
    if (!contract) {
      toast.current({
        type: "error",
        title: "Error",
        description: "Please connect wallet first.",
      });
      return;
    }
    try {
      const tx = await contract.lockTokens({
        value: ethers.parseEther("0.0000000000000001"),
      });
      await tx.wait();
      toast.current({
        type: "notification",
        title: "Success",
        description: "Tokens locked successfully!",
      });
    } catch (error) {
      console.error("Error calling lockTokens:", error);
      toast.current({
        type: "error",
        title: "Error",
        description: "Error locking tokens.",
      });
    }
  }, [contract, toast]);

  const getLockedTokens = useCallback(async () => {
    if (!contract || !walletAddress) {
      toast.current({
        type: "error",
        title: "Error",
        description: "Please connect wallet first.",
      });
      return;
    }
    try {
      const amount = await contract.lockedTokens(walletAddress);
      const formattedAmount = ethers.formatEther(amount);
      setLockedAmount(formattedAmount);
      toast.current({
        type: "notification",
        title: "Locked Tokens",
        description: `You have ${formattedAmount} tokens locked.`,
      });
    } catch (error) {
      console.error("Error fetching locked tokens:", error);
      toast.current({
        type: "error",
        title: "Error",
        description: "Error getting locked tokens.",
      });
    }
  }, [contract, walletAddress, toast]);

  useEffect(() => {
    const checkConnection = async () => {
      if (!window.ethereum) {
        toast.current();
        return;
      }

      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_accounts", []);
      if (accounts.length > 0) {
        const signer = await provider.getSigner();
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
          toast.current({
            type: "notification",
            title: "Account Changed",
            description: `Switched to account: ${formatDisplayAddress(
              accounts[0]
            )}`,
          });
        }
      }
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
    };
  }, [walletAddress, disconnect, toast]);

  const value = useMemo(
    () => ({
      walletAddress,
      displayAddress: formatDisplayAddress(walletAddress),
      isConnected,
      lockedAmount,
      connect,
      disconnect,
      signMessage,
      signMessageForEcdsa,
      bridgeOperator,
      lockTokens,
      getLockedTokens,
    }),
    [
      walletAddress,
      isConnected,
      lockedAmount,
      connect,
      disconnect,
      signMessage,
      signMessageForEcdsa,
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
