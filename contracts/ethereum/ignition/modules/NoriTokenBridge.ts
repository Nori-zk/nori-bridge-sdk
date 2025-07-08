import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const NoriTokenBridgeModule = buildModule("NoriTokenBridgeModule", (m) => {
  const tokenBridge = m.contract("NoriTokenBridge");

  return { tokenBridge };
});

export default NoriTokenBridgeModule;