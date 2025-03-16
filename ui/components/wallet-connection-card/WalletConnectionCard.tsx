"use client";
import WalletButton from "@/components/ui/WalletButton";
import { FaArrowRight } from "react-icons/fa";

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
    <div
      className="relative p-8 rounded-2xl bg-[#07150d]"
      style={{ width, height }}
    >
      <div
        className="absolute inset-0 border-[1px] border-green-600 rounded-2xl pointer-events-none"
        style={{
          maskImage: `radial-gradient(circle, rgba(0,255,127,0) 30%, rgba(0,255,127,1) 50%, rgba(0,255,127,0) 70%),
                  linear-gradient(to bottom, rgba(0,255,127,1), rgba(0,255,127,0))`,
          WebkitMaskImage: `radial-gradient(circle, rgba(0,255,127,0) 30%, rgba(0,255,127,1) 50%, rgba(0,255,127,0) 70%),
                        linear-gradient(to bottom, rgba(0,255,127,1), rgba(0,255,127,0))`,
        }}
      ></div>

      <div className="flex flex-col items-center justify-center h-full">
        <h1 className="text-center text-white text-3xl font-semibold mb-6">
          {title}
        </h1>
        <div className="flex text-white justify-between items-center">
          <WalletButton
            types={"Ethereum"}
            content={"Connect Wallet"}
            // onClick={tryConnectWallet}
            width={200}
          />
          <div className="flex items-center justify-center w-7 h-7 text-black bg-white rounded-full mx-2">
            <FaArrowRight />
          </div>
          <WalletButton types={"Mina"} content={"Connect Wallet"} width={200} />
        </div>
      </div>
    </div>
  );
};

export default WalletConnectionCard;
