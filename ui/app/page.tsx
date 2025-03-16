"use client";
import WalletConnectionCard from "@/components/wallet-connection-card/WalletConnectionCard";
import Image from "next/image";
import Nori from "@/public/assets/nori.svg";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-[#030d08] relative">
      <div className="flex w-full justify-center my-5">
        <Image src={Nori} alt={"Nori-svg"} height={30} />
      </div>
      <div className="flex flex-grow w-full justify-center items-center">
        <WalletConnectionCard
          title={"First connect wallets"}
          width={650}
          height={450}
        />
      </div>
    </div>
  );
}
