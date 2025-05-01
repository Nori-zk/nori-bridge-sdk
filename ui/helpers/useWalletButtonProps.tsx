import { useEthereumWallet } from "@/providers/EthereumWalletProvider";
import { useMinaWallet } from "@/providers/MinaWalletProvider";
import { WalletButtonTypes } from "@/types/types";
import Mina from "@/public/assets/mina.svg";
import Ethereum from "@/public/assets/Ethereum.svg";

type WalletButtonUIProps = {
  bgClass: string;
  textClass: string;
  displayAddress: string;
  logo: React.ReactNode;
  onClick: () => void;
};

export function useWalletButtonProps(
  type: WalletButtonTypes,
  content: string
): WalletButtonUIProps {
  const eth = useEthereumWallet();
  const mina = useMinaWallet();

  const isEthereum = type === "Ethereum";

  if (isEthereum) {
    return {
      bgClass: eth.isConnected ? "bg-connectedGreen" : "bg-white",
      textClass: eth.isConnected ? "text-white" : "text-black",
      displayAddress: eth.isConnected ? eth.displayAddress ?? content : content,
      logo: <Ethereum alt="Ethereum logo" className="scale-[0.65]" />,
      onClick: () => (eth.isConnected ? eth.disconnect() : eth.connect()),
    };
  } else {
    return {
      bgClass: mina.isConnected ? "bg-connectedGreen" : "bg-white",
      textClass: mina.isConnected ? "text-white" : "text-black",
      displayAddress: mina.isConnected
        ? mina.walletDisplayAddress ?? content
        : content,
      logo: <Mina alt="Mina logo" className="scale-[0.65]" />,
      onClick: () => {},
    };
  }
}
