import { useWalletButtonProps } from "@/helpers/useWalletButtonProps";
import { WalletButtonTypes } from "@/types/types";
import clsx from "clsx";

export type WalletButtonProps = {
  id: string;
  types: WalletButtonTypes;
  onClick?: () => void;
  content: string;
  width?: number;
};

const WalletButton = ({
  id,
  types,
  content,
  width,
  onClick,
}: WalletButtonProps) => {
  //used a hook or button styling and functionality props
  const {
    bgClass,
    textClass,
    displayAddress,
    logo,
    onClick: hookOnClick,
  } = useWalletButtonProps(types, content);

  // Use custom onClick if provided, otherwise use hook's onClick
  const handleClick = onClick || hookOnClick;

  return (
    <button
      data-testid={id}
      id={id}
      style={{ width }}
      onClick={handleClick}
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
