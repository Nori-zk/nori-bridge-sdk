"use client";
import TextInput from "@/components/ui/TextInput.tsx";
import { useMetaMaskWallet } from "@/providers/MetaMaskWalletProvider/MetaMaskWalletProvider.tsx";
import { useProgress } from "@/providers/ProgressProvider/ProgressProvider.tsx";
import { useForm } from "react-hook-form";
import ConversionPrices from "@/components/bridge-control-card/ConversionPrices/ConversionPrices.tsx";

type FormValues = {
  amount: string;
};

const LockTokens = () => {
  const { lockTokens } = useMetaMaskWallet();
  const { dispatch } = useProgress();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    defaultValues: { amount: "0.001" },
  });

  const ethAmount = watch("amount");

  const onSubmit = async (data: FormValues) => {
    try {
      const amount = parseFloat(data.amount);
      if (!isNaN(amount) && amount >= 0.004) {
        await lockTokens(amount);
        dispatch({
          type: "NEXT_STEP",
          payload: { nextStep: "get_locked_tokens" },
        });
      } else {
        console.error("Invalid amount");
      }
    } catch (error) {
      console.error("Error locking tokens:", error);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mt-6 w-full text-white rounded-lg px-4 py-3"
    >
      <TextInput
        id="amount-input"
        {...register("amount", {
          required: "Amount is required",
          pattern: {
            value: /^(0|[1-9]\d*)(\.\d+)?$/,
            message: "Must be a valid number",
          },
          min: {
            value: 0.004,
            message: "Must be at least 0.004",
          },
          validate: (value) =>
            parseFloat(value) >= 0.004 || "Must be at least 0.004",
        })}
        placeholder="Enter ETH amount"
      />
      <ConversionPrices ethAmount={parseFloat(ethAmount) || 0} />
      {errors.amount && (
        <p className="text-red-500 text-sm mt-1">{errors.amount.message}</p>
      )}
      <button
        type="submit"
        className="mt-6 w-full text-white rounded-lg px-4 py-3 border-white border-[1px]"
      >
        Lock Tokens
      </button>
    </form>
  );
};

export default LockTokens;
