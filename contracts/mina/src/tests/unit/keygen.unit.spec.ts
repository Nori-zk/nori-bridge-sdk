/**
 * Key generation for loadRunner, with optional one-shot funding.
 *
 * Without funding env set this is a pure offline keygen: it mints N Mina +
 * N Ethereum keypairs and prints a ready-to-paste loadRunner env block.
 *
 * Set the master funder keys to also top the new wallets up in the same run:
 *
 *   KEYGEN_USER_COUNT=8
 *   KEYGEN_FUND_ETH_PRIV_KEY=0x<master eth key>    # unset = skip ETH funding
 *   KEYGEN_FUND_ETH_AMOUNT=0.05                    # ETH per user
 *   ETH_RPC_URL=https://sepolia.infura.io/v3/<key>
 *   KEYGEN_FUND_MINA_PRIV_KEY=EK<master mina key>  # unset = skip MINA funding
 *   KEYGEN_FUND_MINA_AMOUNT=8                      # MINA landing in each wallet
 *   KEYGEN_MINA_TX_FEE_MINA=0.1
 *
 * Mina RPC defaults come from src/env.ts staging and can be overridden with
 * MINA_RPC_NETWORK_URL / MINA_ARCHIVE_RPC_URL / MINA_RPC_NETWORK_ID.
 *
 * Every recipient is a brand-new Mina account, so the master pays the 1 MINA
 * account creation fee on top of KEYGEN_FUND_MINA_AMOUNT for each one — the
 * recipient still lands on exactly the requested amount. Budget per user is
 * therefore amount + 1 + txFee MINA; the run checks the master's balance up
 * front and refuses rather than half-funding the set.
 *
 * Keys are printed BEFORE any funding is attempted, so a funding failure
 * never loses the generated material.
 */
import 'dotenv/config';
import {
    AccountUpdate,
    Mina,
    PrivateKey,
    UInt64,
    fetchAccount,
    type NetworkId,
    type PublicKey,
} from 'o1js';
import { ethers } from 'ethers';
import { env } from '../../env.js';

const staging = env.mina?.staging;

const NANOMINA_PER_MINA = 1e9;

/** Positive-number env read with a default. Rejects junk at the point of use. */
function numEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw == null || raw === '') return fallback;
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
        throw new Error(`${name} must be a positive number (got "${raw}")`);
    }
    return v;
}

const toNanomina = (mina: number) => Math.round(mina * NANOMINA_PER_MINA);
const fmtMina = (nanomina: UInt64) =>
    (Number(nanomina.toBigInt()) / NANOMINA_PER_MINA).toFixed(4);

interface EthRecipient {
    label: string;
    address: string;
}
interface MinaRecipient {
    label: string;
    publicKey: PublicKey;
}

/**
 * Read an account's current nonce straight from the node.
 *
 * `Mina.transaction` takes the fee-payer nonce from `Network.getAccount`,
 * which reads o1js's *local cache only* and never queries the network. So a
 * loop that fetches once up front builds every transaction on the same nonce
 * and only the first one is accepted. Refetching also refreshes that cache,
 * which is what makes the next `Mina.transaction` pick up the new value.
 */
async function fetchNonce(publicKey: PublicKey): Promise<bigint> {
    const { account, error } = await fetchAccount({ publicKey });
    if (!account) {
        throw new Error(
            `could not fetch ${publicKey.toBase58()}: ${error?.statusText ?? 'unknown error'}`
        );
    }
    // toString avoids the toBigInt/toBigint casing difference between o1js
    // integer classes.
    return BigInt(account.nonce.toString());
}

/**
 * Poll until the node reports a nonce past `usedNonce`.
 *
 * A nonce only advances once the transaction actually lands in a block.
 * `pending.wait()` does wait for inclusion, but the GraphQL node we read from
 * can lag a beat behind that, so sending the next transfer immediately can
 * still pick up the pre-send nonce and silently reuse it. Confirming the
 * advance is what makes the sequence safe.
 */
async function waitForNonceAdvance(
    publicKey: PublicKey,
    usedNonce: bigint,
    timeoutMs = 10 * 60_000,
    pollMs = 5_000
): Promise<bigint> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const nonce = await fetchNonce(publicKey);
        if (nonce > usedNonce) return nonce;
        if (Date.now() > deadline) {
            throw new Error(
                `nonce for ${publicKey.toBase58()} still ${nonce} after ${Math.round(timeoutMs / 60_000)}min — ` +
                `the previous funding tx does not appear to have landed`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
}

/**
 * Send a fixed amount of ETH to each new wallet from the master funder,
 * sequentially. Sequential keeps nonces trivially correct and makes a mid-run
 * failure attributable to one recipient.
 *
 * No-op (and says so) when KEYGEN_FUND_ETH_PRIV_KEY is unset.
 */
async function fundEthWallets(recipients: EthRecipient[]): Promise<void> {
    const masterPrivKey = process.env.KEYGEN_FUND_ETH_PRIV_KEY;
    if (!masterPrivKey) {
        console.log(
            '\n=== ETH funding: skipped (KEYGEN_FUND_ETH_PRIV_KEY unset) ==='
        );
        return;
    }

    const rpcUrl = process.env.ETH_RPC_URL;
    if (!rpcUrl) {
        throw new Error(
            'KEYGEN_FUND_ETH_PRIV_KEY is set but ETH_RPC_URL is missing'
        );
    }
    const amountEth = numEnv('KEYGEN_FUND_ETH_AMOUNT', 0.05);

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const master = new ethers.Wallet(masterPrivKey, provider);
    const value = ethers.parseEther(String(amountEth));
    const totalValue = value * BigInt(recipients.length);
    const balance = await provider.getBalance(master.address);

    console.log('\n=== ETH funding ===');
    console.log(`master   : ${master.address}`);
    console.log(`balance  : ${ethers.formatEther(balance)} ETH`);
    console.log(
        `sending  : ${amountEth} x ${recipients.length} = ${ethers.formatEther(totalValue)} ETH (+ gas)`
    );

    // Strictly greater: the transfers themselves still need gas on top.
    if (balance <= totalValue) {
        throw new Error(
            `ETH master ${master.address} holds ${ethers.formatEther(balance)} ETH, ` +
            `needs more than ${ethers.formatEther(totalValue)} ETH to fund ${recipients.length} wallets plus gas`
        );
    }

    for (const r of recipients) {
        const tx = await master.sendTransaction({ to: r.address, value });
        const receipt = await tx.wait();
        console.log(
            `  ${r.label.padEnd(8)} ${r.address}  ${amountEth} ETH  tx ${tx.hash} (block ${receipt?.blockNumber})`
        );
    }
    console.log(`ETH funding complete for ${recipients.length} wallets.`);
}

/**
 * Send a fixed amount of MINA to each new account from the master funder,
 * one transaction per recipient.
 *
 * Each recipient is a fresh account, so every transfer carries an
 * `AccountUpdate.fundNewAccount` — the master pays creation on top of the
 * transfer so the recipient lands on exactly `KEYGEN_FUND_MINA_AMOUNT`.
 *
 * No-op (and says so) when KEYGEN_FUND_MINA_PRIV_KEY is unset.
 */
async function fundMinaAccounts(recipients: MinaRecipient[]): Promise<void> {
    const masterPrivKey = process.env.KEYGEN_FUND_MINA_PRIV_KEY;
    if (!masterPrivKey) {
        console.log(
            '\n=== MINA funding: skipped (KEYGEN_FUND_MINA_PRIV_KEY unset) ==='
        );
        return;
    }

    const networkUrl =
        process.env.MINA_RPC_NETWORK_URL ?? staging?.MINA_RPC_NETWORK_URL;
    const archiveUrl =
        process.env.MINA_ARCHIVE_RPC_URL ?? staging?.MINA_ARCHIVE_RPC_URL;
    const networkId = (process.env.MINA_RPC_NETWORK_ID as
        | NetworkId
        | undefined) ?? staging?.MINA_RPC_NETWORK_ID;
    if (!networkUrl || !archiveUrl || !networkId) {
        throw new Error(
            'KEYGEN_FUND_MINA_PRIV_KEY is set but no Mina RPC config resolved ' +
            '(set MINA_RPC_NETWORK_URL / MINA_ARCHIVE_RPC_URL / MINA_RPC_NETWORK_ID)'
        );
    }

    const amountMina = numEnv('KEYGEN_FUND_MINA_AMOUNT', 8);
    const txFeeMina = numEnv('KEYGEN_MINA_TX_FEE_MINA', 0.1);

    Mina.setActiveInstance(
        Mina.Network({ networkId, mina: networkUrl, archive: archiveUrl })
    );

    const masterKey = PrivateKey.fromBase58(masterPrivKey);
    const masterPub = masterKey.toPublicKey();

    const amount = UInt64.from(toNanomina(amountMina));
    const txFee = toNanomina(txFeeMina);
    const creationFee = Mina.getNetworkConstants().accountCreationFee;

    // What the master parts with per recipient: the transfer, the one-time
    // account creation fee, and the tx fee.
    const perRecipient = amount.add(creationFee).add(UInt64.from(txFee));
    const total = perRecipient.mul(UInt64.from(recipients.length));

    // Also seeds o1js's account cache, which is where Mina.transaction reads
    // the fee-payer nonce from.
    let nonce = await fetchNonce(masterPub);
    const balance = Mina.getAccount(masterPub).balance;

    console.log('\n=== MINA funding ===');
    console.log(`network      : ${networkUrl} (${networkId})`);
    console.log(`master       : ${masterPub.toBase58()}`);
    console.log(`balance      : ${fmtMina(balance)} MINA`);
    console.log(`creation fee : ${fmtMina(creationFee)} MINA per new account`);
    console.log(
        `per user     : ${amountMina} + ${fmtMina(creationFee)} creation + ${txFeeMina} fee = ${fmtMina(perRecipient)} MINA`
    );
    console.log(
        `total        : ${fmtMina(perRecipient)} x ${recipients.length} = ${fmtMina(total)} MINA`
    );

    // Refuse up front rather than stranding the set half-funded.
    if (balance.lessThan(total).toBoolean()) {
        throw new Error(
            `MINA master ${masterPub.toBase58()} holds ${fmtMina(balance)} MINA, ` +
            `needs ${fmtMina(total)} MINA to fund ${recipients.length} new accounts ` +
            `(${amountMina} each + ${fmtMina(creationFee)} creation + ${txFeeMina} fee)`
        );
    }

    console.log(`start nonce  : ${nonce}`);

    // One transfer per transaction, strictly sequential. Batching all N into a
    // single tx would be faster but risks the per-transaction account-update
    // limit, and a single explicit nonce sequence would strand every later
    // transfer if one failed to land. Sequential costs a block per recipient
    // and is trivially recoverable.
    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        // From the second transfer on, the previous one must be visible as a
        // nonce advance before we build against it.
        if (i > 0) nonce = await waitForNonceAdvance(masterPub, nonce);

        const tx = await Mina.transaction(
            { sender: masterPub, fee: txFee, nonce: Number(nonce) },
            async () => {
                // Recipient does not exist yet — master covers creation so the
                // transferred amount arrives intact.
                AccountUpdate.fundNewAccount(masterPub, 1);
                AccountUpdate.createSigned(masterPub).send({
                    to: r.publicKey,
                    amount,
                });
            }
        );
        await tx.prove();
        const pending = await tx.sign([masterKey]).send();
        const included = await pending.wait();
        console.log(
            `  ${r.label.padEnd(8)} ${r.publicKey.toBase58()}  ${amountMina} MINA  nonce ${nonce}  tx ${included.hash}`
        );
    }
    console.log(`MINA funding complete for ${recipients.length} accounts.`);
}

describe('Should generate key pair', () => {
    test('Should generate key pair', () => {
        const { privateKey, publicKey } = PrivateKey.randomKeypair();
        console.log(`privateKey: '${privateKey.toBase58()}'`);
        console.log(`publicKey: '${publicKey.toBase58()}'`);
    });

    test('Should generate Mina + Ethereum keys for loadRunner', async () => {
        const count = Math.trunc(numEnv('KEYGEN_USER_COUNT', 5));
        const minaKeys = Array.from({ length: count }, () =>
            PrivateKey.randomKeypair()
        );
        const ethWallets = Array.from({ length: count }, () =>
            ethers.Wallet.createRandom()
        );
        const labels = Array.from({ length: count }, (_, i) => `user${i}`);

        console.log('\n=== generated accounts ===');
        for (let i = 0; i < count; i++) {
            console.log(`\n[${labels[i]}]`);
            console.log(`  ETH  addr : ${ethWallets[i].address}`);
            console.log(`  ETH  priv : ${ethWallets[i].privateKey}`);
            console.log(`  MINA pub  : ${minaKeys[i].publicKey.toBase58()}`);
            console.log(`  MINA priv : ${minaKeys[i].privateKey.toBase58()}`);
        }

        const ethPrivs = ethWallets.map((w) => w.privateKey).join(',');
        const minaPrivs = minaKeys.map((k) => k.privateKey.toBase58()).join(',');
        const labelsCsv = labels.join(',');

        console.log('\n=== recommended loadRunner env ===');
        console.log(`LOAD_USER_LABELS=${labelsCsv}`);
        console.log(`LOAD_USER_ETH_PRIV_KEYS=${ethPrivs}`);
        console.log(`LOAD_USER_MINA_PRIV_KEYS=${minaPrivs}`);
        console.log('LOAD_LOCK_AMOUNTS_ETH=0.001');
        console.log('LOAD_ETH_MIN_BALANCES=0.005');
        console.log('LOAD_MINA_MIN_BALANCES=2');
        console.log('LOAD_BASE_TICK_MINUTES=6');
        console.log('LOAD_TICK_JITTER_PCT=50');
        console.log(`LOAD_MAX_CONCURRENT=${count}`);
        console.log('LOAD_MAX_CONCURRENT_COMPILES=3');
        console.log('LOAD_PER_USER_COOLDOWN_MINUTES=20');
        console.log('LOAD_MINA_TX_FEE_MINA=0.1');
        console.log('LOAD_LOG_DIR=./logs/loadRunner');

        // Funding last, and only if asked — keys above are already safe on
        // stdout even if either leg below throws.
        await fundEthWallets(
            ethWallets.map((w, i) => ({ label: labels[i], address: w.address }))
        );
        await fundMinaAccounts(
            minaKeys.map((k, i) => ({
                label: labels[i],
                publicKey: k.publicKey,
            }))
        );

        if (
            !process.env.KEYGEN_FUND_ETH_PRIV_KEY ||
            !process.env.KEYGEN_FUND_MINA_PRIV_KEY
        ) {
            console.log(
                '\nFund any skipped side manually before running loadRunner: ' +
                'ETH addresses on Sepolia, MINA addresses on mesa-testnet.'
            );
        }
    });
});
