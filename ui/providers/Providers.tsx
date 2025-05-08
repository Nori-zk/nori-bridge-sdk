"use client";

import React, { ReactNode } from "react";
import { PalladWalletProvider } from "@/providers/PalladWalletProvider";
import { MetaMaskWalletProvider } from "@/providers/MetaMaskWalletProvider";
import { AuroWalletProvider } from "./AuroWalletProvider";

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
