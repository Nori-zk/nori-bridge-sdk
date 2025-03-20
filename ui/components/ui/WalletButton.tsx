"use client";
import Image from "next/image";
import Mina from "@/public/assets/mina.svg";
import Ethereum from "@/public/assets/Ethereum.svg";
import { useEthereumWallet } from "@/providers/EthereumWalletProvider";
import { useMinaWallet } from "@/providers/MinaWalletProvider";
import clsx from "clsx";

type WalletButtonTypes = "Mina" | "Ethereum";

export type MinaButtonProps = {
  id: string;
  types: WalletButtonTypes;
  onClick?: () => void;
  content: string;
  width?: number;
};

const getWalletState = (
  type: WalletButtonTypes,
  ethConnected: boolean,
  ethAddress: string,
  minaConnected: boolean,
  minaAddress: string,
  content: string
) => {
  const isEthereum = type === "Ethereum";
  const connected = isEthereum ? ethConnected : minaConnected;
  const address = isEthereum ? ethAddress : minaAddress;

  return {
    bgClass: connected ? "bg-connectedGreen" : "bg-white",
    textClass: connected ? "text-white" : "text-black",
    displayAddress: connected ? address : content,
    logo: isEthereum ? Ethereum : Mina,
  };
};

const WalletButton = ({ id, types, onClick, content, width }: MinaButtonProps) => {
  const { isConnected: ethConnected, walletDisplayAddress: ethAddress } = useEthereumWallet();
  const { isConnected: minaConnected, walletDisplayAddress: minaAddress } = useMinaWallet();

  const { bgClass, textClass, displayAddress, logo } = getWalletState(
    types,
    ethConnected,
    ethAddress ?? "",
    minaConnected,
    minaAddress ?? "",
    content
  );

  return (
    <button
      id={id}
      style={{ width }}
      className={clsx("flex rounded-lg px-4 py-2 items-center justify-evenly", bgClass, textClass)}
      onClick={onClick}
    >
      <Image src={logo} alt={`${types} logo`} height={20} />
      {displayAddress}
    </button>
  );
};

export default WalletButton;
