import React from "react";
import EthereumGrey from "@/public/assets/EthereumGrey.svg";

type TextInputProps = {
  id: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

const TextInput = ({ id, onChange }: TextInputProps) => {
  return (
    <div className="relative w-full">
      <input
        id={id}
        type="number"
        placeholder="0.00"
        className="w-full bg-transparent text-white/20 placeholder-white/20 border border-white/20 rounded-lg px-4 py-3 pr-20 focus:outline-none focus:ring-2 focus:ring-white/20"
      />
      <div className="absolute inset-y-0 right-4 flex items-center">
        <EthereumGrey alt="EthereumSVG" className="scale-[0.75] opacity-20" />
      </div>
    </div>
  );
};

export default TextInput;
