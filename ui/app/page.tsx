"use client";
import BridgeControlCard from "@/components/bridge-control-card/BridgeControlCard.tsx";
import Nori from "@/public/assets/Nori.svg";
import BottomShadows from "@/public/assets/BottomShadows.svg";
import ScrollingBridge from "@/components/panels/ScrollingBridge/ScrollingBridge.tsx";
import { useMetaMaskWallet } from "@/providers/MetaMaskWalletProvider/MetaMaskWalletProvider.tsx";
import ScrollingWSS from "@/components/panels/ScrollingWSS/ScrollingWSS.tsx";
import { useAccount } from "wagmina";

export default function Home() {
  const { isConnected: ethConnected } = useMetaMaskWallet();
  const { isConnected: minaConnected } = useAccount();
  return (
    <div className="h-full w-full bg-[radial-gradient(50%_100%_at_50%_0%,theme('colors.darkGreen')_1.31%,theme('colors.veryDarkGreen')_100%)]">
      <div className="flex  h-full w-full flex-col relative bg-custom-svg bg-no-repeat bg-cover bg-center">
        <div className="absolute w-full justify-center my-5 flex">
          <Nori className="scale-[0.75]" />
        </div>
        <div className="flex flex-grow w-full justify-center items-center h-full">
          <div className="w-1/4 h-[450px]">
            {ethConnected && minaConnected && <ScrollingWSS />}
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
            title="BottomShadows"
          />
        </div>
      </div>
    </div>
  );
}
