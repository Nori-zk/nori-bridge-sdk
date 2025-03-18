"use client";
import WalletButton from "@/components/ui/WalletButton";
import { FaArrowRight } from "react-icons/fa";
import TextInput from "../ui/TextInput";

type WalletConnectionCardProps = {
  title: string;
  width?: number;
  height?: number;
};

const WalletConnectionCard = ({
  title,
  width = 300,
  height = 300,
}: WalletConnectionCardProps) => {
  return (
    <div className="relative p-8 rounded-2xl" style={{ width, height }}>
      <div
        className="absolute inset-0 border-[1px] border-lightGreen rounded-2xl pointer-events-none"
        style={{
          maskImage: `radial-gradient(circle, rgba(0,255,127,0) 30%, rgb(110,225,143) 50%, rgba(0,255,127,0) 70%),
                  linear-gradient(to bottom, rgb(110,225,143), rgba(0,255,127,0))`,
          WebkitMaskImage: `radial-gradient(circle, rgba(0,255,127,0) 30%, rgb(110,225,143) 50%, rgba(0,255,127,0) 70%),
                        linear-gradient(to bottom, rgb(0,255,127,1), rgba(0,255,127,0))`,
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
        </div>
      </div>
    </div>
  );
};

export default WalletConnectionCard;
