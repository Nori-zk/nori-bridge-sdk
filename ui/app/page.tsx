"use client";
import BridgeControlCard from "@/components/bridge-control-card/BridgeControlCard";
import Nori from "@/public/assets/nori.svg";
import BottomShadows from "@/public/assets/BottomShadows.svg";
import ScrollingMath from "@/components/panels/ScrollingMath";
import ScrollingBridge from "@/components/panels/ScrollingBridge";
import { useEthereumWallet } from "@/providers/EthereumWalletProvider";
import { useMinaWallet } from "@/providers/MinaWalletProvider";

export default function Home() {
  const { isConnected: ethConnected } = useEthereumWallet();
  const { isConnected: minaConnected } = useMinaWallet();
  return (
    <div className="h-full w-full bg-[radial-gradient(50%_100%_at_50%_0%,theme('colors.darkGreen')_1.31%,theme('colors.veryDarkGreen')_100%)]">
      <div className="flex  h-full w-full flex-col relative bg-custom-svg bg-no-repeat bg-cover bg-center">
        <div className="absolute w-full justify-center my-5 flex">
          <Nori className="scale-[0.75]" />
        </div>
        <div className="flex flex-grow w-full justify-center items-center h-full">
          <div className="w-1/4 h-[450px]">
            {ethConnected && minaConnected && <ScrollingMath />}
          </div>
          <div className="1/2">
            <BridgeControlCard
              title={"First connect wallets"}
              width={750}
              height={500}
            />
          </div>
          <div className="w-1/4 h-[450px]">
            {ethConnected && minaConnected && <ScrollingBridge />}
          </div>
        </div>
        <div className="flex w-full justify-center relative">
          <BottomShadows
            className="absolute bottom-[-100px] scale-[0.9]"
            alt="BottomShadows"
          />
        </div>
      </div>
    </div>
  );
}
