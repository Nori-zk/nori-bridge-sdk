"use client";
import { useRef, useState } from "react";
import { useToast } from "@/helpers/useToast.tsx";
import { useAccount } from "wagmina";
import { useProgress } from "@/providers/ProgressProvider/ProgressProvider.tsx";

const StoreCredentials = () => {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const { dispatch, setCredential, credential } = useProgress();
  const { connector } = useAccount();

  const rawToast = useToast({
    type: "error",
    title: "Error",
    description: "",
  });
  const toast = useRef(rawToast);

  const handleStoreCredential = async () => {
    setIsProcessing(true);
    try {
      if (connector && credential) {
        const provider = await connector.getProvider();
        console.log("Provider:", provider);
        if (provider) {
          // @ts-ignore
          await provider.request<"mina_storePrivateCredential">({
            method: "mina_storePrivateCredential",
            params: [JSON.parse(credential)],
          });
        }
      }
      setCredential(undefined);
      dispatch({
        type: "NEXT_STEP",
        payload: { nextStep: "lock_tokens" },
      });
    } catch (error) {
      console.error("Error storing credential:", error);
      toast.current({
        type: "error",
        title: "Error",
        description: "Failed to store credential. Please try again.",
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
        await handleStoreCredential();
      }}
      disabled={isProcessing}
    >
      {isProcessing ? "Processing..." : "Store Credential"}
    </button>
  );
};

export default StoreCredentials;
