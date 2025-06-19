const { ethers } = require("ethers");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

const contractABI = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "when",
        type: "uint256",
      },
    ],
    name: "TokensLocked",
    type: "event",
  },
  {
    inputs: [],
    name: "bridgeOperator",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "lockTokens",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "lockedTokens",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const contractBytecode =
  "0x608060405234801561001057600080fd5b50336000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555061033f806100606000396000f3fe6080604052600436106100345760003560e01c80630a56293d14610039578063590665c2146100435780635eb7413a1461006e575b600080fd5b6100416100ab565b005b34801561004f57600080fd5b50610058610153565b60405161006591906101d0565b60405180910390f35b34801561007a57600080fd5b506100956004803603810190610090919061021c565b610177565b6040516100a29190610262565b60405180910390f35b34600160003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008282546100fa91906102ac565b925050819055503373ffffffffffffffffffffffffffffffffffffffff167fd741e738a23fd18a03a26522320d9fc6cac1fed483e215ea9150fbc2fc43385d34426040516101499291906102e0565b60405180910390a2565b60008054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b60016020528060005260406000206000915090505481565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006101ba8261018f565b9050919050565b6101ca816101af565b82525050565b60006020820190506101e560008301846101c1565b92915050565b600080fd5b6101f9816101af565b811461020457600080fd5b50565b600081359050610216816101f0565b92915050565b600060208284031215610232576102316101eb565b5b600061024084828501610207565b91505092915050565b6000819050919050565b61025c81610249565b82525050565b60006020820190506102776000830184610253565b92915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b60006102b782610249565b91506102c283610249565b92508282019050808211156102da576102d961027d565b5b92915050565b60006040820190506102f56000830185610253565b6103026020830184610253565b939250505056fea2646970667358221220edef300f797756928895e59ca632a02a74d16acf2a9d1837f7cc4e14b9b3597b64736f6c63430008170033";

async function main() {
  if (!process.env.HOLESKY_RPC_URL || !process.env.PRIVATE_KEY) {
    throw new Error(
      "HOLESKY_RPC_URL and PRIVATE_KEY must be set in .env.local file"
    );
  }

  const provider = new ethers.JsonRpcProvider(process.env.HOLESKY_RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(17000)) {
    throw new Error(
      `Connected to wrong network. Expected Holesky (chainId 17000), got chainId ${network.chainId}`
    );
  }

  const balance = await provider.getBalance(signer.address);
  console.log("Wallet address:", signer.address);
  console.log("Wallet balance:", ethers.formatEther(balance), "ETH");
  if (balance === BigInt(0)) {
    throw new Error(
      "Wallet has no Holesky testnet ETH. Request ETH from a faucet."
    );
  }

  const factory = new ethers.ContractFactory(
    contractABI,
    contractBytecode,
    signer
  );

  try {
    console.log("Deploying LockTokens...");
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    console.log("LockTokens deployed to:", contractAddress);
    console.log(
      "Verify contract at:",
      `https://holesky.etherscan.io/address/${contractAddress}`
    );
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
