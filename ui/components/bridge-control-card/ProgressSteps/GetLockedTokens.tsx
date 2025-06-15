import { useMetaMaskWallet } from "@/providers/MetaMaskWalletProvider/MetaMaskWalletProvider.tsx";

const GetLockTokens = () => {
  const { getLockedTokens } = useMetaMaskWallet();

  return (
    <button
      className="mt-6 w-full text-white rounded-lg px-4 py-3 border-white border-[1px]"
      onClick={async () => {
        await getLockedTokens();
      }}
    >
      {"Get Locked Tokens"}
    </button>
  );
};

export default GetLockTokens;
