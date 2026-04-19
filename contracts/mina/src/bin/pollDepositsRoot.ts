import 'dotenv/config';
import { appendFileSync } from 'fs';
import { Mina, PublicKey, fetchAccount, type NetworkId } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { NoriTokenBridge } from '../NoriTokenBridge.js';

const logger = new Logger('PollDepositsRoot');
new LogPrinter('NoriTokenBridge');

const logFile = process.env.POLL_LOG_FILE || 'pollDepositsRoot.log';

function logToFile(msg: string) {
    appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
}

const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.MINA_NETWORK;
const possibleBridgeAddressBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_ADDRESS;
const intervalMs = Number(process.env.POLL_INTERVAL_MS || 10000);

const issues: string[] = [];

if (!possibleNetworkUrl) issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: MINA_NETWORK');
if (!possibleBridgeAddressBase58) issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_ADDRESS');

let possibleBridgeAddress: PublicKey | undefined;
if (possibleBridgeAddressBase58) {
    try {
        possibleBridgeAddress = PublicKey.fromBase58(possibleBridgeAddressBase58);
    } catch (e) {
        issues.push(`NORI_MINA_TOKEN_BRIDGE_ADDRESS is not a valid public key: ${(e as Error).message}`);
    }
}

if (issues.length) {
    logger.fatal(['pollDepositsRoot encountered issues:', ...issues.map((i, idx) => `\t${idx + 1}: ${i}`)].join('\n'));
    process.exit(1);
}

function isString(val: string | undefined): val is string { return val !== undefined; }
function isPublicKey(val: PublicKey | undefined): val is PublicKey { return val !== undefined; }

if (!isString(possibleNetworkUrl) || !isString(possibleNetwork) || !isPublicKey(possibleBridgeAddress)) {
    logger.fatal('Internal error: required values undefined after validation.');
    process.exit(1);
}

const networkUrl = possibleNetworkUrl;
const networkId: NetworkId = possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';
const bridgeAddress = possibleBridgeAddress;

const Network = Mina.Network({ networkId, mina: networkUrl });
Mina.setActiveInstance(Network);

const tokenBridge = new NoriTokenBridge(bridgeAddress);

let lastValue: string | undefined;

async function poll() {
    await fetchAccount({ publicKey: bridgeAddress });
    const value = tokenBridge.latestVerifiedContractDepositsRoot.get().toBigInt().toString();
    if (lastValue === undefined) {
        logger.log(`initial value: ${value}`);
        logToFile(`initial value: ${value}`);
        lastValue = value;
    } else if (value !== lastValue) {
        logger.log(`CHANGED: ${lastValue} -> ${value}`);
        logToFile(`CHANGED: ${lastValue} -> ${value}`);
        lastValue = value;
    }
}

logger.log(`Polling ${possibleBridgeAddressBase58} every ${intervalMs}ms... (log file: ${logFile})`);
logToFile(`Polling ${possibleBridgeAddressBase58} every ${intervalMs}ms...`);
poll().catch((err) => { logger.error(`poll error: ${String(err)}`); });
setInterval(() => { poll().catch((err) => { logger.error(`poll error: ${String(err)}`); }); }, intervalMs);
