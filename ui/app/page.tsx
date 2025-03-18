"use client";
import WalletConnectionCard from "@/components/wallet-connection-card/WalletConnectionCard";
import Image from "next/image";
import Nori from "@/public/assets/nori.svg";
import BottomShadows from "@/public/assets/BottomShadows.svg";
import ScrollingMath from "@/components/panels/ScrollingMath";

export default function Home() {
  return (
    <div className="h-full w-full bg-[radial-gradient(50%_100%_at_50%_0%,theme('colors.darkGreen')_1.31%,theme('colors.veryDarkGreen')_100%)]">
      <div className="flex  h-full w-full flex-col relative bg-custom-svg bg-no-repeat bg-cover bg-center">
        <div className="flex w-full justify-center my-5">
          <Image src={Nori} alt={"Nori-svg"} height={30} />
        </div>
        <div className="flex flex-grow w-full justify-center items-center h-full">
          <div className="w-1/4 h-[450px]">
            <ScrollingMath />
          </div>
          <div className="1/2">
            <WalletConnectionCard
              title={"First connect wallets"}
              width={650}
              height={450}
            />
          </div>
          <div className="w-1/4 h-[450px] text-white">Bridge</div>
        </div>
        <div className="flex w-full justify-center relative">
          <Image
            className="absolute bottom-[-100px] w-full"
            src={BottomShadows}
            alt="BottomShadows"
          />
        </div>
      </div>
    </div>
  );
}
