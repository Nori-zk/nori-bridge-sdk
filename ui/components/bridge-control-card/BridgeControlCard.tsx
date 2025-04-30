"use client";
import WalletButton from "@/components/ui/WalletButton";
import { FaArrowRight } from "react-icons/fa";
import TextInput from "../ui/TextInput";
import { useEffect, useState } from "react";
import { progressSteps } from "@/static_data";
import ProgressTracker from "../ui/ProgressTracker";
import { useEthereumWallet } from "@/providers/EthereumWalletProvider";
import { useMinaWallet } from "@/providers/MinaWalletProvider";

type BridgeControlCardProps = {
  title: string;
  width?: number;
  height?: number;
};

const BridgeControlCard = (props: BridgeControlCardProps) => {
  const { title, width, height } = props;
  const { isConnected: ethConnected } = useEthereumWallet();
  const { isConnected: minaConnected } = useMinaWallet();
  const [displayProgressSteps, setDisplayProgressSteps] = useState(false);

  useEffect(() => {
    if (progressSteps.length > 0) {
      setDisplayProgressSteps(true);
    }
  }, []);

  return (
    <div
      // className="relative rounded-2xl"
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
              content={"Connect Wallet"}
              width={200}
            />
            <div className="flex items-center justify-center w-7 h-7 text-black bg-white rounded-full mx-2">
              <FaArrowRight />
            </div>
            <WalletButton
              id="mina-btn"
              types={"Mina"}
              content={"Connect Wallet"}
              width={200}
            />
          </div>
          <div className="flex justify-center mt-6">
            <TextInput
              id={"amount-input"}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {}}
            />
          </div>
          <div className="w-full">
            <button className="mt-6 w-full text-white rounded-lg px-4 py-3 border-white border-[1px]">
              Connect Wallet
            </button>
          </div>
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
