"use client";

import React, { ReactNode } from "react";
import { MinaWalletProvider } from "@/providers/MinaWalletProvider";
import { EthereumWalletProvider } from "@/providers/EthereumWalletProvider";

interface AppProvidersProps {
  children: ReactNode;
}

const Providers = ({ children }: AppProvidersProps) => {
  return (
    <EthereumWalletProvider>
      <MinaWalletProvider>{children}</MinaWalletProvider>
    </EthereumWalletProvider>
  );
};

export default Providers;
