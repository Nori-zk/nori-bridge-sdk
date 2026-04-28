import { Field, PrivateKey, PublicKey, TokenId } from 'o1js';
import { env } from '../../env.js';

// Mina derives the tokenId for an account owned by `tokenOwner` (under
// `parentTokenId`) as:
//
//   hashWithPrefix(
//     'MinaDeriveTokenId***',
//     packToFields(AccountId.toInput({ tokenOwner, parentTokenId }))
//   )
//
// `parentTokenId` defaults to Field(1) — the Mina ledger's root tokenId. A
// zkApp's `deriveTokenId()` is `TokenId.derive(address)` (default parent),
// which is the convention used for both NoriTokenBase and NoriTokenBridge.
describe('TokenId.derive', () => {
    it('derives a tokenId for any public key (random keypair)', () => {
        const { publicKey } = PrivateKey.randomKeypair();

        const tokenId = TokenId.derive(publicKey);
        const tokenIdAgain = TokenId.derive(publicKey);

        // Deterministic: same input → same tokenId
        expect(tokenId.toString()).toBe(tokenIdAgain.toString());
        // Non-zero, non-default
        expect(tokenId.toString()).not.toBe('0');
        expect(tokenId.toString()).not.toBe(Field(1).toString());
    });

    it('returns distinct tokenIds for distinct public keys', () => {
        const a = PrivateKey.randomKeypair().publicKey;
        const b = PrivateKey.randomKeypair().publicKey;

        expect(TokenId.derive(a).toString()).not.toBe(TokenId.derive(b).toString());
    });

    it('uses Field(1) as the default parentTokenId', () => {
        const { publicKey } = PrivateKey.randomKeypair();

        expect(TokenId.derive(publicKey).toString()).toBe(
            TokenId.derive(publicKey, Field(1)).toString()
        );
    });

    it('is sensitive to parentTokenId', () => {
        const { publicKey } = PrivateKey.randomKeypair();

        const defaultParent = TokenId.derive(publicKey);
        const customParent = TokenId.derive(publicKey, Field(42));

        expect(defaultParent.toString()).not.toBe(customParent.toString());
    });
});

describe('env tokenId values match TokenId.derive(address)', () => {
    // Walk every (network, environment) entry defined in env.ts and verify
    // that the documented tokenIds are reproducible from the stored addresses.
    const cases: Array<{
        network: string;
        envName: string;
        address: string;
        tokenId: string;
        label: string;
    }> = [];

    for (const [network, envs] of Object.entries(env)) {
        if (!envs) continue;
        for (const [envName, cfg] of Object.entries(envs)) {
            if (!cfg) continue;
            cases.push({
                network,
                envName,
                address: cfg.NORI_MINA_TOKEN_BASE_ADDRESS,
                tokenId: cfg.NORI_MINA_TOKEN_BASE_TOKEN_ID,
                label: 'NORI_MINA_TOKEN_BASE',
            });
            cases.push({
                network,
                envName,
                address: cfg.NORI_MINA_TOKEN_BRIDGE_ADDRESS,
                tokenId: cfg.NORI_MINA_TOKEN_BRIDGE_TOKEN_ID,
                label: 'NORI_MINA_TOKEN_BRIDGE',
            });
        }
    }

    it.each(cases)(
        '$network/$envName: $label tokenId matches TokenId.derive(address)',
        ({ address, tokenId }) => {
            const derived = TokenId.derive(PublicKey.fromBase58(address)).toString();
            expect(derived).toBe(tokenId);
        }
    );
});
