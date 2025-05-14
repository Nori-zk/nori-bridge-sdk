"use client";

import React, { ReactNode } from "react";
import { PalladWalletProvider } from "@/providers/PalladWalletProvider/PalladWalletProvider";
import { MetaMaskWalletProvider } from "@/providers/MetaMaskWalletProvider/MetaMaskWalletProvider";
import { AuroWalletProvider } from "@/providers/AuroWalletProvider";

interface AppProvidersProps {
  children: ReactNode;
}

const Providers = ({ children }: AppProvidersProps) => {
  return (
    <MetaMaskWalletProvider>
      {process.env.NEXT_PUBLIC_WALLET == "pallad" ? (
        <PalladWalletProvider>{children}</PalladWalletProvider>
      ) : (
        <AuroWalletProvider>{children}</AuroWalletProvider>
      )}
    </MetaMaskWalletProvider>
  );
};

export default Providers;
