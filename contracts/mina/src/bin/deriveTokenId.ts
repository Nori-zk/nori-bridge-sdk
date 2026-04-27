import { Field, PublicKey, TokenId } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';

const logger = new Logger('DeriveTokenId');
new LogPrinter('NoriTokenBridge');

// Usage:
//   deriveTokenId <publicKeyBase58> [parentTokenId]
//
// Computes the Mina tokenId for an account owned by `publicKeyBase58` under
// `parentTokenId` (default Field(1) — the ledger root). Equivalent to
// o1js `TokenId.derive(publicKey, parentTokenId)`, i.e.
//
//   hashWithPrefix(
//     'MinaDeriveTokenId***',
//     packToFields(AccountId.toInput({ tokenOwner: publicKey, parentTokenId }))
//   )
const [, , publicKeyArg, parentTokenIdArg] = process.argv;

const issues: string[] = [];

if (!publicKeyArg) {
    issues.push('Missing required positional arg: <publicKeyBase58>');
}

let publicKey: PublicKey | undefined;
if (publicKeyArg) {
    try {
        publicKey = PublicKey.fromBase58(publicKeyArg);
    } catch (e) {
        issues.push(`<publicKeyBase58> is not a valid Mina public key: ${(e as Error).message}`);
    }
}

let parentTokenId: Field | undefined;
if (parentTokenIdArg !== undefined) {
    try {
        parentTokenId = Field(BigInt(parentTokenIdArg));
    } catch (e) {
        issues.push(`[parentTokenId] is not a valid Field/bigint: ${(e as Error).message}`);
    }
}

if (issues.length) {
    logger.fatal(
        [
            'deriveTokenId encountered issues:',
            ...issues.map((i, idx) => `\t${idx + 1}: ${i}`),
            '',
            'Usage: deriveTokenId <publicKeyBase58> [parentTokenId]',
        ].join('\n')
    );
    process.exit(1);
}

const tokenId = TokenId.derive(publicKey, parentTokenId);

// Big-endian, zero-padded 32-byte hex — the format used to compare against
// `NORI_BRIDE_ZKAPP_ACCT_TOKEN_ID` (bytes32 immutable) in the
// NoriTokenBridge.sol Ethereum contract. `tokenIdKeyHash` is ABI-decoded from
// the AlignedLayer pubInput as bytes32 and interpreted in big-endian order
// (mirroring how `uint256(appState[i])` is read elsewhere in the contract).
// TODO validate if that's the expected value or do we need to hash it to get 
// to `tokenIdKeyHash` expected by the Solidity contract.
const tokenIdHex32 = `0x${tokenId.toBigInt().toString(16).padStart(64, '0')}`;


logger.log(`Public key:                          ${publicKey.toBase58()}`);
logger.log(`Parent tokenId:                      ${(parentTokenId ?? Field(1)).toString()}${parentTokenIdArg === undefined ? ' (default)' : ''}`);
logger.log(`Derived tokenId (decimal Field):     ${tokenId.toString()}`);
logger.log(`Derived tokenId (bytes32 for Sol):   ${tokenIdHex32}`);
logger.log(`  → use as NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID for NoriTokenBridge.sol deployment`);

// Plain stdout line for piping/scripting — emit the bytes32 hex form so it
// can be fed directly into the Solidity deploy task as an env var.
process.stdout.write(`${tokenIdHex32}\n`);
