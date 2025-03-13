"use client";

import { createContext, ReactNode, useContext } from "react";

interface MinaWalletContextType {
  tryConnectWallet: () => Promise<void>;
}

declare global {
  interface Window {
    mina: any;
  }
}

const MinaWalletContext = createContext<MinaWalletContextType | undefined>(
  undefined
);

export const useMinaWallet = (): MinaWalletContextType => {
  try {
    const context = useContext(MinaWalletContext);
    if (!context) {
      throw new Error("useMinaWallet must be used within a MinaWalletProvider");
    }
    return context;
  } catch (err) {
    throw err;
  }
};

export const MinaWalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const tryConnectWallet = async () => {
    try {
      console.log("This is try connect mina wallet");
    } catch (err) {
      console.log(err);
    }
  };

  const value: MinaWalletContextType = {
    tryConnectWallet,
  };

  return (
    <MinaWalletContext.Provider value={value}>
      {children}
    </MinaWalletContext.Provider>
  );
};
