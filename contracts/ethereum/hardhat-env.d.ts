// Local patch for @nomicfoundation/hardhat-ethers because its type
// augmentation silently fails in the TypeScript language server.
//
// hardhat-ethers ships this exact augmentation in its own type-extensions.d.ts:
//
//     declare module "hardhat/types/network" {
//         interface NetworkConnection<ChainTypeT ...> { ethers: HardhatEthers; }
//     }
//
// `tsc --noEmit` merges it fine. The VS Code LSP does not. Every
// `await hre.network.getOrCreate()` lights up with a red squiggle on
// `.ethers` even though the runtime hook (`newConnection`) unconditionally
// attaches it in
//   @nomicfoundation/hardhat-ethers/dist/src/internal/hook-handlers/network.js
// so the type error is a lie produced by a tooling mismatch, not a real bug.
//
// Root cause is upstream: Hardhat 3's own plugins use inconsistent
// `declare module` specifier styles. Core uses RELATIVE paths, e.g.
//   declare module "../../../../types/hre.js"
// while hardhat-ethers uses the BARE specifier
//   declare module "hardhat/types/network"
// Under `moduleResolution: "nodenext"` tsserver treats those as two distinct
// module identities and refuses to merge the augmentation. tsc's program
// resolver collapses them so the build passes and the IDE breakage goes
// unnoticed by anyone only running the build.
//
// Until this is fixed upstream (one consistent specifier style, or a
// /// <reference> shim from the package entry) we redeclare the augmentation
// here so the editor stops complaining about a property that always exists.
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";

declare module "hardhat/types/network" {
  interface NetworkConnection {
    ethers: HardhatEthers;
  }
}
