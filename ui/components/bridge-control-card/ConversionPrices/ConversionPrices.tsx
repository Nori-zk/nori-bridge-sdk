"use client";
import { useEffect, useState } from "react";
import { FaArrowUp } from "react-icons/fa";

type ConversionPricesProps = {
  ethAmount: number;
};

interface PriceResponse {
  [coinId: string]: {
    usd: number;
    usd_24h_change: number;
  };
}

const ConversionPrices = ({ ethAmount }: ConversionPricesProps) => {
  const [prices, setPrices] = useState<PriceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPrices() {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,mina-protocol&vs_currencies=usd&include_24hr_change=true"
        );
        if (!response.ok) {
          throw new Error("API rate limit exceeded or network error");
        }
        const data: PriceResponse = await response.json();
        setPrices(data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        console.error("Error fetching CoinGecko data:", err);
      }
    }
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000);

    return () => clearInterval(interval);
  }, []);

  if (error) return <div className="text-xs text-red-500">Error: {error}</div>;
  if (!prices) return <div className="text-xs  text-white">Loading...</div>;

  const ethPrice: number = prices.ethereum.usd;
  const minaPrice: number = prices["mina-protocol"].usd;
  const ethChange: string = prices.ethereum.usd_24h_change.toFixed(2);
  const ethToMinaRatio: string = (ethPrice / minaPrice).toFixed(2);
  const minaOutput: string = (ethAmount * parseFloat(ethToMinaRatio)).toFixed(
    2
  );

  return (
    <div className="text-white flex justify-between">
      <div className="text-xs flex items-center">
        ETH: ${ethPrice.toFixed(2)}
        <span
          className={`ml-1 ${
            parseFloat(ethChange) >= 0 ? "text-green-500" : "text-red-500"
          }`}
        >
          {parseFloat(ethChange) >= 0 ? <FaArrowUp /> : "↓"} {ethChange}%
        </span>{" "}
      </div>
      <div className="text-xs">
        {ethAmount} ETH = {minaOutput} MINA
      </div>
    </div>
  );
};

export default ConversionPrices;
