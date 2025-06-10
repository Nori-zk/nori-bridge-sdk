"use client";
import WalletButton from "@/components/ui/WalletButton/WalletButton.tsx";
import { FaArrowRight } from "react-icons/fa";
import { useEffect, useRef, useState } from "react";
import { progressSteps } from "@/static_data.ts";
import ProgressTracker from "../ui/ProgressTracker.tsx";
import { useMetaMaskWallet } from "@/providers/MetaMaskWalletProvider/MetaMaskWalletProvider.tsx";
import { useAccount } from "wagmina";
import { formatDisplayAddress } from "@/helpers/walletHelper.tsx";
import { createEcdsaCredential } from "@/lib/ecdsa-credential.ts";
import { PublicKey } from "o1js";
import { useToast } from "@/helpers/useToast.tsx";

type BridgeControlCardProps = {
  title: string;
  width?: number;
  height?: number;
};

const BridgeControlCard = (props: BridgeControlCardProps) => {
  const { title, width, height } = props;
  const {
    isConnected: ethConnected,
    displayAddress: ethDisplayAddress,
    signMessageForEcdsa,
  } = useMetaMaskWallet();
  const [displayProgressSteps, setDisplayProgressSteps] = useState(false);
  const { isConnected: minaConnected, address: minaAddress } = useAccount();
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("abc");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [credential, setCredential] = useState<string | undefined>();

  const { connector } = useAccount();

  const rawToast = useToast({
    type: "error",
    title: "Error",
    description: "",
  });
  const toast = useRef(rawToast);

  useEffect(() => {
    setIsMounted(true);
    if (progressSteps.length > 0) {
      setDisplayProgressSteps(true);
    }
  }, []);

  const minaButtonContent = isMounted
    ? minaConnected
      ? formatDisplayAddress(minaAddress ?? "") || "Connect Wallet"
      : "Connect Wallet"
    : "Connect Wallet";

  const handleCreateCredential = async () => {
    setIsProcessing(true);
    try {
      const { signature, walletAddress, hashedMessage } =
        await signMessageForEcdsa(message);
      const cred = await createEcdsaCredential(
        message,
        PublicKey.fromBase58(minaAddress ?? ""),
        signature,
        walletAddress
      );
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
    <div
      style={{
        width,
        height,
        boxShadow:
          "-21px 0px 15px -15px lightGreen, 21px 0px 15px -15px LightGreen",
        borderRadius: "20px",
        border: "0.5px solid var(--lightGreen)",
      }}
    >
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent, transparent), linear-gradient(180deg, transparent, transparent), linear-gradient(270deg, transparent, transparent), linear-gradient(0deg, transparent, transparent)",
          backgroundSize: "100% 1px, 1px 100%, 100% 1px, 1px 100%",
          backgroundPosition: "0 0, 100% 0, 0 100%, 0 0",
          backgroundRepeat: "no-repeat",
          mask: "radial-gradient(circle at top left, lightGreen 0%, rgba(6, 59, 231, 0.3) 20%, transparent 50%),radial-gradient(circle at top right, rgba(204, 21, 21, 0.8) 0%, rgba(34, 197, 94, 0.3) 20%, transparent 50%),radial-gradient(circle at bottom right, rgba(34, 197, 94, 0.8) 0%, rgba(34, 197, 94, 0.3) 20%, transparent 50%),radial-gradient(circle at bottom left, rgba(34, 197, 94, 0.8) 0%, rgba(34, 197, 94, 0.3) 20%, transparent 50%)",
          maskComposite: "source-over",
          WebkitMaskComposite: "source-over",
          border: "1px solid lightGreen)",
        }}
      ></div>

      <div className="flex flex-col items-center justify-center h-full">
        <h1 className="text-center text-white text-3xl mb-6">{title}</h1>
        <div className="w-3/4">
          <div className="flex text-white justify-between items-center ">
            <WalletButton
              id="eth-btn"
              types={"Ethereum"}
              content={
                ethConnected ? ethDisplayAddress ?? "" : "Connect Wallet"
              }
            />
            <div className="flex items-center justify-center w-7 h-7 text-black bg-white rounded-full mx-2">
              <FaArrowRight />
            </div>
            <WalletButton
              id="mina-btn"
              types={"Mina"}
              content={minaButtonContent}
            />
          </div>
          <div className="flex justify-center mt-6">
            {/* <TextInput
              id={"message-input"}
              onChange={(e) => setMessage(e.target.value)}
              value={message}
              placeholder="Enter message to sign"
            /> */}
          </div>
          <>
            {!ethConnected ? (
              <button
                className="mt-6 w-full text-white rounded-lg px-4 py-3 border-white border-[1px]"
                onClick={async () => {}}
              >
                {"Connect Wallet"}
              </button>
            ) : (
              <div className="w-full flex">
                <button
                  className="mt-6 w-full text-white rounded-lg px-4 py-3 border-white border-[1px]"
                  onClick={async () => {
                    await handleCreateCredential();
                  }}
                  disabled={isProcessing}
                >
                  {isProcessing ? "Processing..." : "Create Credential"}
                </button>
              </div>
            )}
          </>
          {credential !== undefined && (
            <div className="w-full flex">
              <button
                className="mt-6 w-full text-white rounded-lg px-4 py-3 border-white border-[1px]"
                onClick={async () => {
                  await handleStoreCredential();
                }}
                disabled={isProcessing}
              >
                {isProcessing ? "Processing..." : "Store Credential"}
              </button>
            </div>
          )}

          {ethConnected && minaConnected && (
            <div>
              <div className="flex flex-col items-center m-6">
                <div className="text-white">
                  Wallet Linking Is Required For The First Time
                </div>
                <div className="text-lightGreen">
                  Bridge Contracts Are Compiling
                </div>
              </div>
              {displayProgressSteps && (
                <ProgressTracker steps={progressSteps} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BridgeControlCard;
