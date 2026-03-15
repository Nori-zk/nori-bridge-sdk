import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const NoriTokenBridgeModule = buildModule("NoriTokenBridgeModule", (m) => {
  const bridgeOperator = m.getParameter("bridgeOperator");

  const tokenBridge = m.contract("NoriTokenBridge", [bridgeOperator]);

  return { tokenBridge };
});

export default NoriTokenBridgeModule;