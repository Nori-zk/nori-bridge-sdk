"use client";
import { useRef, useState } from "react";
import { PublicKey } from "o1js";
import { useMetaMaskWallet } from "@/providers/MetaMaskWalletProvider/MetaMaskWalletProvider.tsx";
import { useToast } from "@/helpers/useToast.tsx";
import { createEcdsaCredential } from "@/lib/ecdsa-credential.ts";
import { useAccount } from "wagmina";
import { useProgress } from "@/providers/ProgressProvider/ProgressProvider.tsx";

const CreateCredentials = () => {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("abc");

  const {
    isConnected: ethConnected,
    displayAddress: ethDisplayAddress,
    signMessageForEcdsa,
  } = useMetaMaskWallet();
  const { isConnected, address } = useAccount();
  const { dispatch, setCredential } = useProgress();

  const rawToast = useToast({
    type: "error",
    title: "Error",
    description: "",
  });
  const toast = useRef(rawToast);

  const handleCreateCredential = async () => {
    setIsProcessing(true);
    try {
      const { signature, walletAddress, hashedMessage } =
        await signMessageForEcdsa(message);
      const cred = await createEcdsaCredential(
        message,
        PublicKey.fromBase58(address ?? ""),
        signature,
        walletAddress
      );
      setCredential(cred);
      dispatch({
        type: "NEXT_STEP",
        payload: { nextStep: "store_credential" },
      });
      toast.current({
        type: "notification",
        title: "Success",
        description: "Credential created successfully!",
      });
      setCredential(cred);
    } catch (error) {
      console.error("Error creating credential:", error);
      toast.current({
        type: "error",
        title: "Error",
        description: "Failed to create credential. Please try again.",
      });
      setCredential(undefined);
    } finally {
      setIsProcessing(false);
    }
  };
  return (
    <button
      className="mt-6 w-full text-white rounded-lg px-4 py-3 border-white border-[1px]"
      onClick={async () => {
        await handleCreateCredential();
      }}
      disabled={isProcessing}
    >
      {isProcessing ? "Processing..." : "Create Credential"}
    </button>
  );
};

export default CreateCredentials;
