"use client";
import WalletConnectionCard from "@/components/wallet-connection-card/WalletConnectionCard";
import Image from "next/image";
import Nori from "@/public/assets/nori.svg";
import { createStore } from "@mina-js/connect";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

const store = createStore();

export default function Home() {
  const [currentProvider, setCurrentProvider] = useLocalStorage(
    "minajs:provider",
    ""
  );

  type Provider = {
    request<M>(params: {
      method: M;
      params?: any;
      context?: any;
    }): Promise<any>;
  };
  let provider: Provider | undefined;

  let providers: any[] = [];
  window.addEventListener("mina:announceProvider", (event: any) => {
    providers.push(event.detail);
  });
  window.dispatchEvent(new Event("mina:requestProvider"));

  function getProvider(): Provider {
    console.log("providers", providers);
    console.log("here");
    console.log("provider", provider);
    if (provider !== undefined) return provider;

    // find pallad provider
    // TODO: use mina-js for this once it's compatible
    provider = providers.find((provider) => {
      console.log(provider.info);
      return provider.info.slug === "pallad";
    })?.provider;
    if (provider === undefined) throw Error("Provider not found");
    return provider;
  }

  //   const providers = useSyncExternalStore(
  //     store.subscribe,
  //     store.getProviders,
  //     () => []
  //   );

  //   const provider = providers.find(
  //     (p) => p.info.slug === currentProvider
  //   )?.provider;

  useEffect(() => {
    // const fetchRequestAccounts = async () => {
    //   console.log("provider", provider);
    //   console.log("providers", providers);
    //   if (!provider) return;
    //   const { result } = await provider.request({
    //     method: "mina_requestAccounts",
    //   });
    //   console.log("fetchRequestAccounts", result);
    // };
    // fetchRequestAccounts();
    getProvider();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#030d08] relative">
      <div className="flex w-full justify-center my-5">
        <Image src={Nori} alt={"Nori-svg"} height={30} />
      </div>
      <div className="flex flex-grow w-full justify-center items-center">
        <WalletConnectionCard
          title={"First connect wallets"}
          width={650}
          height={450}
        />
      </div>
    </div>
  );
}
