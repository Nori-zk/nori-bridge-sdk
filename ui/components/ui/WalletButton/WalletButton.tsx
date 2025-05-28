"use client";
import { useWalletButtonProps } from "@/helpers/useWalletButtonProps";
import { WalletButtonTypes } from "@/types/types";
import clsx from "clsx";
import { useState, useEffect } from "react";

export type WalletButtonProps = {
  id: string;
  types: WalletButtonTypes;
  onClick?: () => void;
  content?: string;
  width?: number;
};

const WalletButton = ({
  id,
  types,
  content = "Connect Wallet",
  width = 200,
  onClick,
}: WalletButtonProps) => {
  const [isMounted, setIsMounted] = useState(false);
  const {
    bgClass,
    textClass,
    displayAddress,
    logo,
    onClick: hookOnClick,
    isConnecting,
  } = useWalletButtonProps(types, content);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleClick = onClick || hookOnClick;

  if (!isMounted) {
    return (
      <button
        data-testid={id}
        id={id}
        style={{ width }}
        onClick={handleClick}
        className={clsx(
          "px-4 py-2 rounded-lg flex items-center justify-evenly",
          "bg-white",
          "text-black"
        )}
      >
        {logo}
        {content}
      </button>
    );
  }

  return (
    <button
      data-testid={id}
      id={id}
      style={{ width }}
      onClick={handleClick}
      disabled={isConnecting}
      className={clsx(
        "px-4 py-2 rounded-lg flex items-center justify-evenly",
        bgClass,
        textClass,
        isConnecting && "opacity-50 cursor-not-allowed"
      )}
    >
      {logo}
      {displayAddress}
    </button>
  );
};

export default WalletButton;
