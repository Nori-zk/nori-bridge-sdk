import { writeFileSync } from "fs";
import { task } from "hardhat/config";
import path from "path";
import { fileURLToPath } from "url";
import '../logger.js';
import { Logger } from "esm-iso-logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger("Deploy");

const DEVNET_NETWORKS = new Set(["hardhat"]);

export const deploy = task("deploy", "Deploy MinaAccountValidation, MinaStateSettlement, and NoriTokenBridge")
  .setAction(async () => ({
    default: async (_args, hre) => {
      const { ethers } = await hre.network.getOrCreate();

      const [deployer] = await ethers.getSigners();
      const balance = await ethers.provider.getBalance(deployer.address);
      const network = await ethers.provider.getNetwork();

      const possibleAlignedServiceManagerAddress = process.env.ALIGNED_ETH_SERVICE_MANAGER_ADDRESS;
      const possibleEthNetwork = process.env.ETH_NETWORK;
      const possibleZkappTokenId = process.env.NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID;
      const possibleZkappVkHash = process.env.NORI_ETH_BRIDGE_ZKAPP_VERIFICATION_KEY_HASH;

      const issues: string[] = [];
      const bytes32Re = /^0x[0-9a-fA-F]{64}$/;

      if (!possibleAlignedServiceManagerAddress) issues.push("Missing required env: ALIGNED_ETH_SERVICE_MANAGER_ADDRESS (run npm run pre-deploy first)");
      if (!possibleEthNetwork) issues.push("Missing required env: ETH_NETWORK");
      if (!possibleZkappTokenId) issues.push("Missing required env: NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID (32-byte hex of the Mina zkApp tokenID)");
      else if (!bytes32Re.test(possibleZkappTokenId)) issues.push("NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID must be a 0x-prefixed 32-byte hex string");
      if (!possibleZkappVkHash) issues.push("Missing required env: NORI_ETH_BRIDGE_ZKAPP_VERIFICATION_KEY_HASH (keccak256 of the ABI-encoded NoriStorage zkApp verification key)");
      else if (!bytes32Re.test(possibleZkappVkHash)) issues.push("NORI_ETH_BRIDGE_ZKAPP_VERIFICATION_KEY_HASH must be a 0x-prefixed 32-byte hex string");

      if (issues.length) {
        logger.error("Deploy encountered errors:");
        issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
        logger.fatal("Due to issues with environment variables deploy cannot continue.");
        process.exit(1);
      }

      const alignedServiceManagerAddress = possibleAlignedServiceManagerAddress;
      const ethNetwork = possibleEthNetwork;
      const zkappTokenId = possibleZkappTokenId;
      const zkappVkHash = possibleZkappVkHash;
      const devnetFlag = DEVNET_NETWORKS.has(ethNetwork);

      const bridgeOperator =
        process.env.NORI_ETH_BRIDGE_OPERATOR_ADDRESS || deployer.address;
      const feeRecipient =
        process.env.NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS || ethers.ZeroAddress;

      logger.log(`Deploying with account: ${deployer.address}`);
      logger.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
      logger.log(`Network: ${network.name} (chainId: ${network.chainId})`);
      logger.log(`Configuration:`);
      logger.log(`  NORI_ETH_BRIDGE_OPERATOR_ADDRESS: ${process.env.NORI_ETH_BRIDGE_OPERATOR_ADDRESS || "(defaulting to deployer)"}`);
      logger.log(`  NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID: ${zkappTokenId}`);
      logger.log(`  NORI_ETH_BRIDGE_ZKAPP_VERIFICATION_KEY_HASH: ${zkappVkHash}`);
      logger.log(`  NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS: ${process.env.NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS || "(not set)"}`);
      logger.log(`  NORI_ETH_BRIDGE_LOCK_FEE_RATE: ${process.env.NORI_ETH_BRIDGE_LOCK_FEE_RATE || "(not set)"}`);
      logger.log(`  NORI_ETH_BRIDGE_UNLOCK_FEE_RATE: ${process.env.NORI_ETH_BRIDGE_UNLOCK_FEE_RATE || "(not set)"}`);


      // Deploy MinaAccountValidation
      logger.log("Deploying MinaAccountValidation...");
      const MinaAccountValidation = await ethers.getContractFactory("MinaAccountValidation");
      const accountValidation = await MinaAccountValidation.deploy(alignedServiceManagerAddress);
      const accountValidationDeployTx = accountValidation.deploymentTransaction();
      if (!accountValidationDeployTx) throw new Error("MinaAccountValidation did not deploy");
      const accountValidationReceipt = await accountValidationDeployTx.wait();
      if (!accountValidationReceipt) throw new Error("MinaAccountValidation receipt invalid");
      logger.log(`MinaAccountValidation deployed to: ${accountValidation.target}`);
      logger.log(`Gas used: ${accountValidationReceipt.gasUsed.toString()}`);

      // Deploy MinaStateSettlement
      logger.log("Deploying MinaStateSettlement...");
      const MinaStateSettlement = await ethers.getContractFactory("MinaStateSettlement");
      const stateSettlement = await MinaStateSettlement.deploy(alignedServiceManagerAddress, devnetFlag);
      const stateSettlementDeployTx = stateSettlement.deploymentTransaction();
      if (!stateSettlementDeployTx) throw new Error("MinaStateSettlement did not deploy");
      const stateSettlementReceipt = await stateSettlementDeployTx.wait();
      if (!stateSettlementReceipt) throw new Error("MinaStateSettlement receipt invalid");
      logger.log(`MinaStateSettlement deployed to: ${stateSettlement.target}`);
      logger.log(`Gas used: ${stateSettlementReceipt.gasUsed.toString()}`);

      // Deploy NoriTokenBridge
      logger.log("Deploying NoriTokenBridge...");
      const NoriTokenBridge = await ethers.getContractFactory("NoriTokenBridge");
      const tokenBridge = await NoriTokenBridge.deploy(
        bridgeOperator,
        stateSettlement.target,
        accountValidation.target,
        zkappTokenId,
        zkappVkHash,
        feeRecipient
      );
      const tokenBridgeDeployTx = tokenBridge.deploymentTransaction();
      if (!tokenBridgeDeployTx) throw new Error("NoriTokenBridge did not deploy");
      const tokenBridgeReceipt = await tokenBridgeDeployTx.wait();
      if (!tokenBridgeReceipt) throw new Error("NoriTokenBridge receipt invalid");
      logger.log(`NoriTokenBridge deployed to: ${tokenBridge.target}`);
      logger.log(`Deployed in block: ${tokenBridgeReceipt.blockNumber}`);
      logger.log(`Gas used: ${tokenBridgeReceipt.gasUsed.toString()}`);

      const lockFeeRate = process.env.NORI_ETH_BRIDGE_LOCK_FEE_RATE;
      if (lockFeeRate) {
        logger.log(`Setting lock fee rate: ${lockFeeRate} (1 unit = 0.001%)`);
        const setLockFeeRateTx = await tokenBridge.setLockFeeRate(parseInt(lockFeeRate));
        await setLockFeeRateTx.wait();
      }

      const unlockFeeRate = process.env.NORI_ETH_BRIDGE_UNLOCK_FEE_RATE;
      if (unlockFeeRate) {
        logger.log(`Setting unlock fee rate: ${unlockFeeRate} (1 unit = 0.001%)`);
        const setUnlockFeeRateTx = await tokenBridge.setUnlockFeeRate(parseInt(unlockFeeRate));
        await setUnlockFeeRateTx.wait();
      }

      // Write deployment details to .env.nori-eth-token-bridge
      const envFilePath = path.resolve(__dirname, "..", ".env.nori-eth-token-bridge");
      const env = {
        NORI_ETH_TOKEN_BRIDGE_ADDRESS: tokenBridge.target,
        NORI_ETH_MINA_STATE_SETTLEMENT_ADDRESS: stateSettlement.target,
        NORI_ETH_MINA_ACCOUNT_VALIDATION_ADDRESS: accountValidation.target,
        NORI_ETH_BRIDGE_OPERATOR_ADDRESS: bridgeOperator,
      };
      const envContent =
        Object.entries(env)
          .map(function([key, value]) { return `${key}=${value}`; })
          .join("\n") + "\n";
      writeFileSync(envFilePath, envContent, { encoding: "utf8" });

      logger.log(`Wrote ${envFilePath}`);
      logger.log("Environment variables for future use:");
      for (const [key, value] of Object.entries(env)) {
        logger.log(`${key}=${value}`);
      }
    },
  }))
  .build();
