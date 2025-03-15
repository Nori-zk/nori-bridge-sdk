"use client";
import WalletConnectionCard from "@/components/wallet-connection-card/WalletConnectionCard";
import Image from "next/image";
import Nori from "@/public/assets/nori.svg";
import { createStore } from "@mina-js/connect";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

// const store = createStore();

const CodeSampleModal = dynamic(() => import("@/components/home/Home"), {
  ssr: false,
});

export default CodeSampleModal;
// export default function Home() {
//   const [currentProvider, setCurrentProvider] = useLocalStorage(
//     "minajs:provider",
//     ""
//   );

//   // Add getServerSnapshot to handle server-side rendering
//   const providers = useSyncExternalStore(
//     store.subscribe,
//     store.getProviders, // Client-side snapshot
//     () => [] // Server-side snapshot (default value)
//   );

//   const provider = providers.find(
//     (p) => p.info.slug === currentProvider
//   )?.provider;

//   useEffect(() => {
//     const fetchRequestAccounts = async () => {
//       if (!provider) return;
//       const { result } = await provider.request({
//         method: "mina_requestAccounts",
//       });
//       console.log("fetchRequestAccounts", result);
//     };
//     fetchRequestAccounts();
//   }, [provider]);

//   return (
//     <div className="min-h-screen flex flex-col bg-[#030d08] relative">
//       <div className="flex w-full justify-center my-5">
//         <Image src={Nori} alt={"Nori-svg"} height={30} />
//       </div>
//       <div className="flex flex-grow w-full justify-center items-center">
//         <WalletConnectionCard
//           title={"First connect wallets"}
//           width={650}
//           height={450}
//         />
//       </div>
//     </div>
//   );
// }
