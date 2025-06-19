import { http } from "vimina";
import { devnet, mainnet } from "vimina/chains";
import { createConfig } from "wagmina";

const chain = process.env.NEXT_PUBLIC_CHAIN === "mainnet" ? mainnet : devnet;

export const config = createConfig({
  chains: [chain],
  transports: {
    [mainnet.id]: http(),
    [devnet.id]: http(),
  },
});
