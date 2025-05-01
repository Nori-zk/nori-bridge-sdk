import { useWalletButtonProps } from "@/helpers/useWalletButtonProps";
import { WalletButtonTypes } from "@/types/types";
import clsx from "clsx";

type MinaButtonProps = {
  id: string;
  types: WalletButtonTypes;
  onClick?: () => void;
  content: string;
  width?: number;
};

const WalletButton = ({ id, types, content, width }: MinaButtonProps) => {
  //used a hook or button styling and functionality props
  const { bgClass, textClass, displayAddress, logo, onClick } =
    useWalletButtonProps(types, content);

  return (
    <button
      id={id}
      style={{ width }}
      onClick={onClick}
      className={clsx(
        "px-4 py-2 rounded-lg flex items-center justify-evenly",
        bgClass,
        textClass
      )}
    >
      {logo}
      {displayAddress}
    </button>
  );
};

export default WalletButton;
